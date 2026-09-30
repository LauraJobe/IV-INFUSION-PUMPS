/*
 * Compact large-volume pump simulator, modeled on the programming workflow in
 * the B. Braun Infusomat Space Instructions for Use: a small black display,
 * no number keypad (values are dialed in with the arrow keys, digit by digit),
 * OK, C (clear/back), Start/Stop, a drug library with care units, soft limits
 * (override Yes/No) and hard limits the editor will not pass, and a
 * SECondary menu for piggybacks. For education only: not the manufacturer's
 * software.
 *
 * It exposes the same state shape and log events as the other pumps so
 * practice mode, the check-off and grading are shared.
 */

const Space = (() => {
  const BOOT_MS = 2600;
  const PUMP_MAX = 1200;
  const GROUPS = ["ABC", "DEF", "GHI", "JKL", "MNO", "PQR", "STU", "VWX", "YZ"];
  let S;
  const listeners = [];
  let bootTimer = null;

  function newBedside() {
    return { primed: false, loaded: false, traced: false, clampOpen: false, occluded: false, air: false, primaryBag: 0, primaryBagName: "", secondaryHung: false, secondaryClampOpen: false, secondaryBag: 0, secondaryBagName: "" };
  }
  function newChannel(id) {
    return { id, state: "idle", primary: null, secondary: null, onSecondary: false, vi: 0, alarm: null, bedside: newBedside() };
  }

  function reset() {
    clearTimeout(bootTimer);
    S = {
      on: false, t: 0, profile: null, weight: null, patientId: null,
      channels: { A: newChannel("A"), B: newChannel("B") },
      screen: { id: "off" }, spec: null, draft: null, prevSec: [], autoChange: true,
      silencedUntil: 0, flash: null, log: [],
    };
    emit();
  }

  const log = (type, data = {}) => S.log.push(Object.assign({ t: S.t, type, pump: "space" }, data));
  const onChange = (fn) => listeners.push(fn);
  function emit() { listeners.forEach((fn) => fn(S)); }
  function flash(text, kind = "info") { S.flash = { text, kind, until: Date.now() + 3200 }; }
  function go(id, ctx = {}) { S.screen = Object.assign({}, ctx, { id }); emit(); }
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const ch = () => S.channels.A;

  // ------------------------------------------------------------ program helpers
  const hasDose = (p) => !!(p && p.mode === "guardrails" && p.drug && p.drug.dose);
  const doseUnit = (p) => (hasDose(p) ? doseUnitLabel(p.drug).replace("/hr", "/h") : "ml/h");
  const drugLabel = (p) => (!p ? "" : p.mode === "basic" ? "Basic infusion" : p.drug.name);
  const needsWeight = (d) => hasDose(d) && d.drug.dose.perKg;

  function newDraft(drug, conc, secondary, mode) {
    const d = { mode: mode || "guardrails", drugId: drug ? drug.id : null, drug, conc, secondary: !!secondary, dose: null, rate: null, vtbi: null, time: null, overrides: [], row: 0 };
    // IVPB secondaries: the library fills VTBI with the bag volume (check it against the order).
    if (secondary && drug && !drug.dose && conc && conc.vol) d.vtbi = conc.vol;
    return d;
  }

  function rowsFor(d) {
    const r = [];
    if (d.secondary && !hasDose(d)) r.push("vtbi", "time", "rate");
    else {
      if (hasDose(d)) r.push("dose", "rate");
      else r.push("rate");
      r.push("vtbi", "time");
    }
    if (needsWeight(d)) r.push("weight");
    return r;
  }

  function recalc(d, f) {
    const w = S.weight;
    const dose = hasDose(d);
    if (f === "dose" || f === "weight") { if (dose && d.dose != null && (!needsWeight(d) || w)) d.rate = r1(doseToRate(d.drug, d.conc, d.dose, w)); }
    if ((f === "rate" || f === "time") && dose && d.rate && (!needsWeight(d) || w)) d.dose = r2(rateToDose(d.drug, d.conc, d.rate, w));
    if (f === "time" && d.time) {
      if (d.rate) d.vtbi = r1(d.rate * d.time / 60);
      else if (d.vtbi) { d.rate = r1(d.vtbi / (d.time / 60)); if (dose) d.dose = r2(rateToDose(d.drug, d.conc, d.rate, w)); }
    } else if (d.rate && d.vtbi) d.time = Math.max(1, Math.round((d.vtbi / d.rate) * 60));
  }

  // ------------------------------------------------------------ editor (arrow-key digit entry)
  function fieldDef(d, f) {
    const l = d.mode === "guardrails" && d.drug ? d.drug.limits : {};
    switch (f) {
      case "dose": return { label: "Doserate", unit: doseUnit(d), int: 4, dec: 2, max: l.hardMax != null ? l.hardMax : 9999, min: l.hardMin != null ? l.hardMin : 0 };
      case "rate": return { label: "Rate", unit: "ml/h", int: 4, dec: 1, max: !hasDose(d) && l.hardMax != null ? Math.min(l.hardMax, PUMP_MAX) : PUMP_MAX, min: 0, pumpMax: hasDose(d) || l.hardMax == null || l.hardMax >= PUMP_MAX };
      case "vtbi": return { label: "VTBI", unit: "ml", int: 4, dec: 1, max: 9999, min: 0 };
      case "weight": return { label: "Weight", unit: "kg", int: 3, dec: 1, max: 350, min: 0 };
      case "time": return { label: "Time", unit: "h:min", time: true, max: 99 * 60 + 59, min: 0 };
    }
  }
  const stepsOf = (def) => (def.time ? [1, 10, 60, 600] : Array.from({ length: def.int + def.dec }, (_, i) => Math.pow(10, i - def.dec)));

  function openEditor(f) {
    const d = S.draft, def = fieldDef(d, f);
    const cur = f === "weight" ? S.weight : d[f];
    const steps = stepsOf(def);
    const running = d.existing && ["running", "kvo"].includes(ch().state);
    go("editor", { field: f, def, val: cur || 0, confirmed: cur || 0, pos: def.time ? 2 : def.dec, steps, back: running ? "run" : "home" });
  }

  function editorKey(k) {
    const sc = S.screen, def = sc.def;
    const step = sc.steps[sc.pos];
    const fix = (v) => Math.round(v * 100) / 100;
    if (k === "LEFT") { sc.pos = Math.min(sc.steps.length - 1, sc.pos + 1); return emit(); }
    if (k === "RIGHT") { sc.pos = Math.max(0, sc.pos - 1); return emit(); }
    if (k === "UP") {
      const nv = fix(sc.val + step);
      if (nv > def.max + 1e-9) {
        if (sc.val < def.max - 1e-9) {
          // The editor stops at the hard limit (the manual: it shows the highest acceptable value).
          if (["dose", "rate"].includes(sc.field)) log("hardLimit", { ch: "A", drugId: S.draft.drugId, val: nv, limit: def.max, dir: "max", clamped: true });
          sc.val = def.max; return emit();
        }
        return hardAlert("upper", sc);
      }
      sc.val = nv; return emit();
    }
    if (k === "DOWN") {
      const nv = fix(sc.val - step);
      if (nv < def.min - 1e-9) {
        if (sc.val > def.min + 1e-9) { sc.val = def.min; return emit(); }
        if (def.min > 0) return hardAlert("lower", sc);
        return;
      }
      sc.val = nv; return emit();
    }
    if (k === "C") {
      if (sc.val !== 0) { sc.val = 0; return emit(); }
      return go(sc.back);
    }
    if (k === "OK") return confirmEditor();
  }

  function hardAlert(dir, sc) {
    const d = S.draft;
    if (["dose", "rate"].includes(sc.field)) log("hardLimit", { ch: "A", drugId: d.drugId, val: sc.val, limit: dir === "upper" ? sc.def.max : sc.def.min, dir: dir === "upper" ? "max" : "min" });
    go("hardMsg", { dir, editor: sc });
  }

  function confirmEditor() {
    const sc = S.screen, d = S.draft, f = sc.field, v = sc.val;
    if (!(v > 0)) { flash("Enter a value", "warn"); return emit(); }
    // Soft limits apply to the doserate (or the rate for rate-based library entries).
    const limited = (f === "dose" && hasDose(d)) || (f === "rate" && !hasDose(d) && d.mode === "guardrails");
    if (limited) {
      const l = d.drug.limits;
      const done = (dir) => d.overrides.some((o) => o.dir === dir && Math.abs(o.val - v) < 1e-9);
      let dir = null;
      if (l.softMax != null && v > l.softMax + 1e-9 && !done("max")) dir = "max";
      else if (l.softMin != null && v < l.softMin - 1e-9 && !done("min")) dir = "min";
      if (dir) {
        log("softLimit", { ch: "A", drugId: d.drugId, val: v, limit: dir === "max" ? l.softMax : l.softMin, dir });
        return go("softMsg", { editor: sc, dir, lo: l.softMin, hi: l.softMax });
      }
    }
    applyValue(sc);
  }

  function applyValue(sc) {
    const d = S.draft, f = sc.field, v = sc.val;
    if (sc.back === "run") return titrate(f, v);
    if (f === "weight") { S.weight = v; log("weight", { kg: v }); recalc(d, "weight"); }
    else { d[f] = v; recalc(d, f); }
    // Move the highlight to the next row that still needs a value.
    const rows = homeRows();
    const need = rows.findIndex((r) => r.edit && r.empty);
    d.row = need >= 0 ? need : Math.min(rows.length - 1, rows.findIndex((r) => r.key === f) + 1);
    go("home");
  }

  function titrate(f, v) {
    const c = ch(), p = c.onSecondary && c.secondary ? c.secondary : c.primary;
    const d = S.draft;
    const from = { dose: p.dose, rate: p.rate };
    if (f === "dose") { p.dose = v; p.rate = r1(doseToRate(p.drug, p.conc, v, S.weight)); }
    else if (f === "rate") { p.rate = v; if (hasDose(p)) p.dose = r2(rateToDose(p.drug, p.conc, v, S.weight)); }
    else if (f === "vtbi") { p.vtbi = v; p.remaining = v; log("newVtbi", { ch: "A", vtbi: v, rate: p.rate }); if (c.state === "kvo") { c.state = "running"; c.alarm = null; } return go("run"); }
    else if (f === "weight") {
      S.weight = v; log("weight", { kg: v });
      // A new weight keeps the dose and changes the rate.
      if (hasDose(p) && p.drug.dose.perKg) { p.rate = r1(doseToRate(p.drug, p.conc, p.dose, v)); log("titrate", { ch: "A", drugId: p.drugId, fromDose: from.dose, toDose: p.dose, fromRate: from.rate, toRate: p.rate, state: c.state }); }
      return go("run");
    } else if (f === "time") { flash("Change the rate or VTBI while running", "warn"); return go("run"); }
    p.overrides = p.overrides.concat(d.overrides.filter((o) => !p.overrides.includes(o)));
    log("titrate", { ch: "A", drugId: p.drugId, fromDose: from.dose, toDose: p.dose, fromRate: from.rate, toRate: p.rate, state: c.state });
    go("run");
  }

  // ------------------------------------------------------------ home screen rows
  function homeRows() {
    const d = S.draft;
    if (!d) return [];
    const c = ch();
    const fmt = (v, dig) => (v == null || v === 0 ? "---" : fmtNum(v, dig));
    const rows = rowsFor(d).map((f) => {
      const val = f === "weight" ? S.weight : d[f];
      const shown = f === "time" ? (val ? `${Math.floor(val / 60)}:${String(Math.round(val % 60)).padStart(2, "0")}` : "---") : fmt(val, f === "dose" ? 3 : 1);
      const unit = f === "dose" ? doseUnit(d) : f === "rate" ? "ml/h" : f === "vtbi" ? "ml" : f === "time" ? "h:min" : "kg";
      return { key: f, label: fieldDef(d, f).label, value: shown, unit, edit: !(f === "rate" && hasDose(d)), empty: !val };
    });
    // Menu items on the home screen when the pump is stopped with a primary program.
    if (!d.secondary && c.primary && c.state === "stopped") rows.push({ key: "sec", label: "SECondary", menu: true }, { key: "totals", label: "Infused Totals", menu: true });
    return rows;
  }
  const ready = (d) => d && d.rate > 0 && d.vtbi > 0 && (!needsWeight(d) || S.weight > 0);

  function homeSelect() {
    const d = S.draft, rows = homeRows(), r = rows[d.row];
    if (!r) return;
    if (r.key === "sec") return go("secMenu", { cur: 0, list: secMenuList() });
    if (r.key === "totals") return go("totals");
    if (!r.edit) { flash("This value cannot be changed", "warn"); return emit(); }
    openEditor(r.key);
  }

  // ------------------------------------------------------------ running
  function start() {
    const d = S.draft, c = ch(), b = c.bedside;
    if (!ready(d)) { flash(needsWeight(d) && !S.weight ? "Enter the patient weight" : "Enter rate and VTBI", "warn"); return emit(); }
    if (d.secondary && S.screen.id !== "secCheck") return go("secCheck");
    const prog = { mode: d.mode, drugId: d.drugId, drug: d.drug, conc: d.conc, dose: d.dose, rate: d.rate, vtbi: d.vtbi, remaining: d.vtbi, overrides: d.overrides.slice(), weight: S.weight };
    if (d.secondary) {
      c.secondary = prog; c.onSecondary = true;
      log("startSecondary", { ch: "A", drugId: d.drugId, mode: d.mode, rate: d.rate, vtbi: d.vtbi, dose: d.dose, concVol: d.conc && d.conc.vol, overrides: d.overrides.length, traced: true, hung: b.secondaryHung, clamp: b.secondaryClampOpen });
      S.prevSec = [prog].concat(S.prevSec.filter((p) => p.drugId !== prog.drugId)).slice(0, 5);
    } else {
      c.primary = prog; c.onSecondary = false;
      log("start", { ch: "A", drugId: d.drugId, mode: d.mode, concVol: d.conc && d.conc.vol, concAmt: d.conc && d.conc.amt, dose: d.dose, rate: d.rate, vtbi: d.vtbi, traced: true, weight: needsWeight(d) ? S.weight : S.weight, profile: S.profile, overrides: d.overrides.length });
    }
    if (d.mode === "basic") log("basicInfusion", { ch: "A" });
    c.state = "running"; c.alarm = null;
    go("run");
  }

  function stopPump() {
    const c = ch();
    c.state = "stopped"; log("pause", { ch: "A" });
    // Back on the home screen for the program that was running.
    const p = c.primary;
    S.draft = c.onSecondary && c.secondary ? draftFrom(c.secondary, true) : draftFrom(p, false);
    go("home");
  }
  function draftFrom(p, sec) {
    return { mode: p.mode, drugId: p.drugId, drug: p.drug, conc: p.conc, secondary: sec, dose: p.dose, rate: p.rate, vtbi: r1(p.remaining), time: p.rate ? Math.round((p.remaining / p.rate) * 60) : null, overrides: p.overrides.slice(), row: 0, existing: true };
  }

  const ALARMS = {
    complete: { msg: "VTBI infused", level: "high" },
    secComplete: { msg: "SECondary complete", level: "low" },
  };
  function raise(type) {
    const c = ch();
    c.alarm = Object.assign({ type }, ALARMS[type]);
    S.silencedUntil = 0;
    log("alarm", { ch: "A", alarm: type === "complete" ? "complete" : "secComplete" });
  }

  function tick(dt) {
    if (!S.on || S.screen.id === "boot") return;
    S.t += dt;
    const c = ch(), dth = dt / 3600;
    if (c.state === "running" || c.state === "kvo") {
      if (c.onSecondary && c.secondary) {
        const s = c.secondary, v = Math.min(s.rate * dth, s.remaining);
        s.remaining -= v; c.vi += v;
        if (s.remaining <= 0.0001) {
          c.onSecondary = false; c.secondary = null;
          log("secondaryComplete", { ch: "A", fromPrimary: 0 });
          if (!S.autoChange) { c.state = "stopped"; raise("secComplete"); }
          else if (S.screen.id === "run") emit();
        }
      } else if (c.primary) {
        const p = c.primary;
        if (c.state === "kvo") c.vi += Math.min(1, p.rate) * dth;
        else {
          const v = Math.min(p.rate * dth, p.remaining);
          p.remaining = Math.max(0, p.remaining - v); c.vi += v;
          if (p.remaining <= 0.0001) { c.state = "kvo"; raise("complete"); log("complete", { ch: "A" }); }
        }
      }
    }
    emit();
  }

  function currentRate(c) {
    if (c.state === "kvo") return Math.min(1, c.primary.rate);
    if (c.state !== "running") return 0;
    return c.onSecondary && c.secondary ? c.secondary.rate : c.primary ? c.primary.rate : 0;
  }

  // ------------------------------------------------------------ keys
  function power() {
    if (!S.on) {
      S.on = true; log("powerOn"); go("boot");
      bootTimer = setTimeout(() => { if (S.screen.id === "boot") go("newPatient"); }, BOOT_MS);
      return;
    }
    if (["running", "kvo"].includes(ch().state)) { flash("Stop the infusion first", "warn"); emit(); return; }
    clearTimeout(bootTimer); S.on = false; log("powerOff"); go("off");
  }

  function key(k) {
    if (!S.on || S.screen.id === "boot") return;
    const sc = S.screen, c = ch();
    // An alarm is acknowledged with OK before anything else.
    if (c.alarm && k === "OK" && ["run", "home", "landing"].includes(sc.id)) {
      S.silencedUntil = Date.now() + 120000; log("silence");
      c.alarm = null;
      return emit();
    }
    if (k === "BOLUS") { flash("Bolus is not used in practice"); return emit(); }
    if (k === "AUTO") { flash("Auto-programming is not used in practice"); return emit(); }
    if (k === "DOOR") { flash(c.state === "running" ? "Stop the infusion first" : "Close the roller clamp before opening the door", "warn"); return emit(); }
    if (sc.id === "editor") return editorKey(k);
    if (sc.id === "hardMsg") { if (k === "OK") { const e = sc.editor; e.val = e.confirmed; go("editor", e); } return; }
    if (sc.id === "softMsg") {
      const e = sc.editor;
      if (k === "UP") { S.draft.overrides.push({ dir: sc.dir, val: e.val }); log("override", { ch: "A", drugId: S.draft.drugId, val: e.val, dir: sc.dir }); return applyValue(e); }
      if (k === "DOWN") { log("softReenter", { ch: "A" }); e.val = e.confirmed; return go("editor", e); }
      return;
    }
    if (sc.id === "newPatient") {
      if (k === "UP") { const b = c.bedside; S.channels.A = Object.assign(newChannel("A"), { bedside: b }); S.weight = null; S.profile = null; log("newPatient", { yes: true }); return go("landing"); }
      if (k === "DOWN") { log("newPatient", { yes: false }); if (c.primary) { S.draft = draftFrom(c.primary, false); return go(c.state === "running" ? "run" : "home"); } return go("landing"); }
      return;
    }
    if (sc.id === "continueLast") {
      if (k === "UP") { log("newPatient", { yes: false }); S.draft = draftFrom(c.primary, false); return go(c.state === "running" ? "run" : "home"); }
      if (k === "DOWN") { const b = c.bedside; S.channels.A = Object.assign(newChannel("A"), { bedside: b }); S.weight = null; log("newPatient", { yes: true }); return go("landing"); }
      return;
    }
    if (sc.id === "landing") { if (k === "OK") return S.profile ? toDrugs(false) : toCareUnit(); return; }
    if (sc.list) return listKey(k);
    if (sc.id === "advisory") { if (k === "OK" || k === "LEFT") return afterAdvisory(sc); if (k === "C") return toDrugs(sc.secondary); return; }
    if (sc.id === "secCheck") { if (k === "STARTSTOP") return start(); if (k === "C") return go("home"); return; }
    if (sc.id === "totals") { if (k === "C" || k === "OK") return go("home"); return; }
    if (sc.id === "clearSec") {
      if (k === "UP") { c.onSecondary = false; c.secondary = null; S.draft = draftFrom(c.primary, false); log("channelOff", { ch: "A", secondary: true }); return go("home"); }
      if (k === "DOWN") return go("home");
      return;
    }
    if (sc.id === "home") return homeKey(k);
    if (sc.id === "run") return runKey(k);
  }

  function homeKey(k) {
    const d = S.draft, rows = homeRows(), c = ch();
    if (k === "UP") { d.row = (d.row - 1 + rows.length) % rows.length; return emit(); }
    if (k === "DOWN") { d.row = (d.row + 1) % rows.length; return emit(); }
    if (k === "LEFT" || k === "OK") return homeSelect();
    if (k === "STARTSTOP") {
      if (d.existing && c.state === "stopped" && ready(d) && !d.secondary) { log("resume", { ch: "A", fromAlarm: null }); c.state = "running"; return go("run"); }
      if (d.existing && d.secondary && c.state === "stopped" && ready(d)) { c.state = "running"; log("resume", { ch: "A", fromAlarm: null }); return go("run"); }
      return start();
    }
    if (k === "C") {
      if (["running", "kvo"].includes(c.state)) return go("run");
      if (d.secondary && d.existing && c.onSecondary) return go("clearSec");
      if (d.secondary) { S.draft = draftFrom(c.primary, false); return go("home"); }
      if (!d.existing) { log("cancelProgram", { ch: "A" }); return toDrugs(false); }
    }
  }

  function runKey(k) {
    const c = ch();
    if (k === "STARTSTOP") return stopPump();
    if (k === "LEFT") {
      const p = c.onSecondary && c.secondary ? c.secondary : c.primary;
      if (!p) return;
      S.draft = draftFrom(p, c.onSecondary);
      return openEditor(hasDose(p) ? "dose" : "rate");
    }
    if (k === "C") { const p = c.onSecondary && c.secondary ? c.secondary : c.primary; S.draft = draftFrom(p, c.onSecondary); return go("home"); }
    if (k === "UP" || k === "DOWN") { S.runInfo = ((S.runInfo || 0) + (k === "UP" ? 2 : 1)) % 3; return emit(); }
  }

  // ------------------------------------------------------------ lists
  function listKey(k) {
    const sc = S.screen, n = sc.list.length;
    const selectable = (i) => !sc.list[i].header;
    const move = (dir) => { let i = sc.cur; for (let t = 0; t < n; t++) { i = (i + dir + n) % n; if (selectable(i)) break; } sc.cur = i; };
    if (k === "UP") { move(-1); return emit(); }
    if (k === "DOWN") { move(1); return emit(); }
    if (k === "RIGHT" && sc.id === "drugList") {
      // Jump to the next letter group (ABC, DEF, ...).
      const g = sc.list.findIndex((it, i) => i > sc.cur && it.header);
      sc.cur = g >= 0 ? g : 0; move(1); return emit();
    }
    if (k === "C") return listBack(sc);
    if (k === "OK" || k === "LEFT") return listPick(sc);
  }

  function listBack(sc) {
    if (sc.id === "careUnit") return go("landing");
    if (sc.id === "drugList") return sc.back === "subcat" ? toSubcat(sc.secondary) : toDrugs(sc.secondary);
    if (sc.id === "subcat") return toDrugs(sc.secondary);
    if (sc.id === "category") { if (sc.secondary) return go("secMenu", { cur: 0, list: secMenuList() }); return toCareUnit(); }
    if (sc.id === "concList") return toDrugs(sc.secondary);
    if (sc.id === "secMenu") { S.draft = draftFrom(ch().primary, false); return go("home"); }
    if (sc.id === "prevSec") return go("secMenu", { cur: 0, list: secMenuList() });
  }

  function listPick(sc) {
    const it = sc.list[sc.cur];
    if (sc.id === "careUnit") {
      if (it.basic) return basicInfusion(false);
      S.profile = it.pid; log("profile", { profile: it.pid });
      return toDrugs(false);
    }
    if (sc.id === "category") {
      if (it.basic) return basicInfusion(sc.secondary);
      if (it.key === "fluids") return toDrugList(sc.secondary, (d) => drugCategory(d).top === "IV Fluids", "category");
      return toSubcat(sc.secondary);
    }
    if (sc.id === "subcat") return toDrugList(sc.secondary, (d) => drugCategory(d).top === "Medications" && (it.sub === "*" || drugCategory(d).sub === it.sub), "subcat");
    if (sc.id === "drugList") {
      if (it.basic) return basicInfusion(sc.secondary);
      const drug = it.drug;
      log("drugPicked", { ch: "A", drugId: drug.id });
      if (drug.concs.length > 1) return go("concList", { list: drug.concs.map((c) => ({ label: concText(drug, c), conc: c })), cur: 0, drug, secondary: sc.secondary });
      return chosen(drug, drug.concs[0], sc.secondary);
    }
    if (sc.id === "concList") return chosen(sc.drug, it.conc, sc.secondary);
    if (sc.id === "secMenu") {
      if (it.key === "new") return toDrugs(true);
      if (it.key === "prev") { if (!S.prevSec.length) { flash("No previous SECondary infusions", "warn"); return emit(); } return go("prevSec", { list: S.prevSec.map((p) => ({ label: `${drugLabel(p)} ${concText(p.drug, p.conc)}`, prog: p })), cur: 0 }); }
      if (it.key === "back") { S.autoChange = !S.autoChange; flash(`SEC change to PRIM: ${S.autoChange ? "auto" : "manual"}`); return emit(); }
      if (it.key === "basic") return basicInfusion(true);
    }
    if (sc.id === "prevSec") { const p = it.prog; S.draft = Object.assign(draftFrom(Object.assign({}, p, { remaining: p.vtbi }), true), { existing: false }); return go("home"); }
  }

  const secMenuList = () => [{ label: "New SECondary", key: "new" }, { label: "Use a previous SEC infusion", key: "prev" }, { label: `Back to PRIM: ${S.autoChange ? "auto" : "manual"}`, key: "back" }, { label: "Basic infusion", key: "basic" }];
  const concText = (drug, c) => (!c ? "" : c.amt ? `${fmtNum(c.amt, 3)}${c.unit === "units" ? " units" : c.unit}/${fmtNum(c.vol)}ml` : `${fmtNum(c.vol)}ml`);

  function toCareUnit() {
    const pids = Object.keys(PROFILES);
    go("careUnit", { list: pids.map((pid) => ({ label: PROFILES[pid].name.replace("Adult ", ""), pid })).concat([{ label: "Basic infusion", basic: true }]), cur: Math.max(0, pids.indexOf(S.profile)) });
  }

  // Category first (IV Fluids or Medications), then the medication type.
  function toDrugs(secondary) {
    go("category", { list: [{ label: "IV Fluids", key: "fluids" }, { label: "Medications", key: "meds" }, { label: "Basic infusion", basic: true }], cur: secondary ? 1 : 0, secondary });
  }
  function toSubcat(secondary) {
    const drugs = profileDrugList(S.profile).filter((d) => drugCategory(d).top === "Medications");
    const subs = MED_GROUPS.map(([name]) => name).concat(["Other medications"]).filter((n) => drugs.some((d) => drugCategory(d).sub === n));
    go("subcat", { list: subs.map((n) => ({ label: n, sub: n })).concat([{ label: "All medications", sub: "*" }]), cur: 0, secondary });
  }
  function toDrugList(secondary, filter, back) {
    const drugs = profileDrugList(S.profile).filter(filter);
    const list = [];
    GROUPS.forEach((g) => {
      const inG = drugs.filter((d) => g.includes(d.name.replace(/[^A-Za-z]/g, "")[0].toUpperCase()));
      if (!inG.length) return;
      list.push({ label: g, header: true });
      inG.forEach((d) => list.push({ label: d.name, drug: d }));
    });
    list.push({ label: "Basic infusion", basic: true });
    go("drugList", { list, cur: 1, secondary, back });
  }

  function chosen(drug, conc, secondary) {
    log("drugSelected", { ch: "A", drugId: drug.id, conc: concLabel(drug, conc), secondary: !!secondary });
    if (drug.highAlert) return go("advisory", { drug, conc, secondary });
    afterAdvisory({ drug, conc, secondary });
  }
  function afterAdvisory(sc) {
    S.draft = newDraft(sc.drug, sc.conc, sc.secondary);
    const d = S.draft;
    if (needsWeight(d) && !S.weight) { d.row = rowsFor(d).indexOf("weight"); go("home"); return openEditor("weight"); }
    d.row = 0;
    go("home");
    // Open the doserate/rate editor straight away (no defaults in this practice library).
    if (!d.secondary) openEditor(hasDose(d) ? "dose" : "rate");
    else { d.row = rowsFor(d).indexOf("vtbi"); emit(); }
  }

  function basicInfusion(secondary) {
    log("basicSelected", { ch: "A", secondary: !!secondary });
    S.draft = newDraft(null, null, secondary, "basic");
    go("home");
    openEditor("rate");
  }

  // ------------------------------------------------------------ screens
  function spec() {
    const sc = S.screen, c = ch();
    const mode = () => (S.draft && S.draft.secondary) || (c.onSecondary && sc.id === "run") ? "SEC" : "PRIM";
    const base = { lines: [], tags: [], alert: null };
    switch (sc.id) {
      case "off": return { off: true };
      case "boot": return { boot: true };
      case "landing": return Object.assign(base, { landing: true, lines: [{ text: "Press OK to program an infusion", small: true }] });
      case "newPatient": return Object.assign(base, { head: c.primary ? `Last therapy: ${drugLabel(c.primary)}` : "Patient", lines: [{ text: "New patient?", sel: true, right: "Yes ▲<br>No ▼" }, { text: "Yes clears the last patient's data", small: true }] });
      case "continueLast": return Object.assign(base, { head: `Last therapy: ${drugLabel(c.primary)}`, tags: ["PRIM"], lines: [{ text: "Continue last infusion?", sel: true, right: "Yes ▲<br>No ▼" }] });
      case "careUnit": return listSpec(base, "Select Care Unit", sc);
      case "category": return listSpec(base, `Select category${sc.secondary ? " · SEC" : ""}`, sc);
      case "subcat": return listSpec(base, `Medications${sc.secondary ? " · SEC" : ""}`, sc);
      case "drugList": return listSpec(base, `${PROFILES[S.profile] ? PROFILES[S.profile].name.replace("Adult ", "") : "Drugs"}${sc.secondary ? " · SEC" : ""}`, sc);
      case "concList": return listSpec(base, "Select concentration", sc);
      case "secMenu":
        sc.list = secMenuList();
        return listSpec(base, "SEC", sc);
      case "prevSec": return listSpec(base, "Previous SEC infusions", sc);
      case "advisory": return Object.assign(base, { head: sc.drug.name, lines: [{ text: "HIGH ALERT medication." }, { text: "Independent double check.", small: true }, { text: "OK Confirm", tag: true }] });
      case "home": return homeSpec(base, mode());
      case "editor": return editorSpec(base, sc, mode());
      case "hardMsg": return Object.assign(base, { box: `Value ${sc.dir === "upper" ? "above" : "below"} drug or pump<br>${sc.dir} hard limit`, boxTag: "OK Confirm", alert: "hard" });
      case "softMsg": return Object.assign(base, { head: `Soft Limit: ${sc.lo != null ? fmtNum(sc.lo, 3) : "0"}-${sc.hi != null ? fmtNum(sc.hi, 3) : "—"}`, lines: [{ text: `Override with ${fmtNum(sc.editor.val, 3)} ${sc.editor.def.unit} ?`, sel: true, right: "Yes ▲<br>No ▼" }], alert: "soft" });
      case "secCheck": return Object.assign(base, { box: "Check bag height!<br>Open SECondary clamp", boxTag: "Start/Stop to confirm" });
      case "clearSec": return Object.assign(base, { head: "SEC", lines: [{ text: "Clear SEC infusion?", sel: true, right: "Yes ▲<br>No ▼" }] });
      case "totals": return Object.assign(base, { head: "Infused Totals", lines: [{ text: `Total Vol: ${fmtNum(c.vi, 1)} ml` }, { text: "C Back", tag: true }] });
      case "run": return runSpec(base);
    }
    return base;
  }

  function listSpec(base, head, sc) {
    const start = Math.max(0, Math.min(sc.cur - 1, sc.list.length - 3));
    return Object.assign(base, { head, lines: sc.list.slice(start, start + 3).map((it, i) => ({ text: it.label, sel: start + i === sc.cur, header: it.header, arrow: start + i === sc.cur })), scroll: sc.list.length > 3 });
  }

  function homeSpec(base, mode) {
    const d = S.draft, rows = homeRows();
    const start = Math.max(0, Math.min(d.row - 1, rows.length - 3));
    return Object.assign(base, {
      home: true, tags: [mode], drug: d.mode === "basic" ? "Basic" : d.drug.name, start: ready(d) && ch().state !== "running",
      lines: rows.slice(start, start + 3).map((r, i) => ({ text: r.label, right: r.menu ? "" : `${r.value} ${r.unit}`, sel: start + i === d.row, arrow: start + i === d.row, menu: r.menu })),
      scroll: rows.length > 3,
    });
  }

  function editorSpec(base, sc, mode) {
    const def = sc.def;
    let cells;
    if (def.time) {
      const h = Math.floor(sc.val / 60), m = Math.round(sc.val % 60);
      const digs = [String(Math.floor(h / 10)), String(h % 10), ":", String(Math.floor(m / 10)), String(m % 10)];
      const posIdx = { 3: 0, 2: 1, 1: 3, 0: 4 };
      cells = digs.map((ch, i) => ({ ch: i === 0 && ch === "0" && posIdx[sc.pos] !== 0 ? "_" : ch, on: posIdx[sc.pos] === i }));
    } else {
      const n = def.int + def.dec;
      const scaled = Math.round(sc.val * Math.pow(10, def.dec));
      const digits = String(scaled).padStart(n, "0").slice(-n).split("");
      const firstNz = digits.findIndex((x) => x !== "0");
      let lastNz = -1; digits.forEach((x, i) => { if (x !== "0") lastNz = i; });
      cells = [];
      digits.forEach((dg, i) => {
        const p = n - 1 - i - def.dec; // place value exponent
        const on = sc.steps[sc.pos] === Math.pow(10, p);
        let ch = dg;
        if (p > 0 && (firstNz === -1 || i < firstNz) && !on) ch = "_";
        if (p < 0 && i > lastNz && !on) ch = "_";
        cells.push({ ch, on });
        if (p === 0 && def.dec) cells.push({ ch: "." });
      });
    }
    const d = S.draft;
    let foot = "C Clear";
    if (sc.field === "dose" || sc.field === "weight") { const rr = sc.val && (!needsWeight(d) || (sc.field === "weight" ? sc.val : S.weight)) && hasDose(d) && d.dose ? "" : ""; foot = `C Clear${rr}`; }
    if (sc.field === "rate" && d.vtbi) foot = `Time: ${sc.val ? `${Math.floor((d.vtbi / sc.val))}:${String(Math.round(((d.vtbi / sc.val) * 60) % 60)).padStart(2, "0")}` : "--"} [h:min]`;
    if (sc.field === "time" && d.vtbi && !d.rate) foot = `Rate: ${sc.val ? fmtNum(r1(d.vtbi / (sc.val / 60)), 1) : "--"} ml/h`;
    if (sc.field === "dose" && hasDose(d) && (!needsWeight(d) || S.weight)) foot = `Rate: ${sc.val ? fmtNum(r1(doseToRate(d.drug, d.conc, sc.val, S.weight)), 1) : "--"} ml/h`;
    return Object.assign(base, { editor: true, tags: [mode, sc.back === "run" ? "Change" : "OK Confirm"], label: def.label, cells, unit: def.unit, foot });
  }

  function runSpec(base) {
    const c = ch();
    const p = c.onSecondary && c.secondary ? c.secondary : c.primary;
    if (!p) return base;
    const info = [`Total Vol: ${fmtNum(c.vi, 2)}ml`, `VTBI rem.: ${fmtNum(p.remaining, 1)}ml`, `${PROFILES[S.profile] ? PROFILES[S.profile].name.replace("Adult ", "") : ""}`][S.runInfo || 0];
    const hi = p.overrides.some((o) => o.dir === "max"), lo = p.overrides.some((o) => o.dir === "min");
    return Object.assign(base, {
      run: true, tags: [c.onSecondary ? "SEC" : "PRIM"], running: c.state === "running" || c.state === "kvo", kvo: c.state === "kvo",
      drug: p.mode === "basic" ? "Basic" : p.drug.name, limit: hi ? "▲" : lo ? "▼" : "", big: fmtNum(hasDose(p) ? p.dose : currentRate(c) || p.rate, hasDose(p) ? 3 : 1),
      unit: hasDose(p) ? doseUnit(p) : "ml/h", info,
    });
  }

  function render() {
    if (S.flash && Date.now() > S.flash.until) S.flash = null;
    const sp = spec(), c = ch();
    if (c.alarm && !sp.off && !sp.boot) { sp.alarm = c.alarm; sp.alert = sp.alert || (c.alarm.level === "high" ? "hard" : "soft"); }
    S.spec = sp;
    return sp;
  }

  // Programming started but the infusion (or the change) is not started yet.
  function pending() {
    const sc = S.screen;
    if (["concList", "advisory", "softMsg", "hardMsg", "secCheck"].includes(sc.id)) return true;
    if (["drugList", "category", "subcat"].includes(sc.id)) return true;
    if (sc.id === "editor") return true;
    if (sc.id === "home") return !!S.draft && !(S.draft.existing && ch().state === "stopped" && !S.draft.secondary);
    return false;
  }

  function bedside(chId, action) { log("bedside", { ch: chId, action }); emit(); }

  const READY = { primed: true, loaded: true, traced: true, clampOpen: true };

  // Mid-shift setup used by practice mode (same config shape as the other pumps).
  function preset(cfg) {
    reset();
    S.on = true; S.profile = cfg.profile; S.weight = cfg.weight || null; S.patientId = cfg.patientId || null;
    const c = ch();
    Object.assign(c.bedside, READY, { primaryBag: 1000 });
    const a = (cfg.channels || []).find((x) => x.ch === "A");
    if (a) Object.assign(c.bedside, a.bedside || {});
    if (a && a.drugId) {
      const drug = profileDrug(cfg.profile, a.drugId), conc = drug.concs[a.concIdx || 0];
      let rate = a.rate, dose = a.dose;
      if (dose != null && drug.dose) rate = r1(doseToRate(drug, conc, dose, S.weight));
      if (rate != null && dose == null && drug.dose) dose = r2(rateToDose(drug, conc, rate, S.weight));
      c.primary = { mode: "guardrails", drugId: a.drugId, drug, conc, dose, rate, vtbi: a.vtbi, remaining: a.remaining != null ? a.remaining : a.vtbi, overrides: [], weight: S.weight };
      c.state = "running";
      S.screen = { id: "run" };
    } else S.screen = { id: "landing" };
    if (cfg.fresh) { S.profile = null; S.weight = null; S.screen = { id: "newPatient" }; }
    emit();
  }

  reset();
  return {
    get state() { return S; }, reset, preset, tick, render, onChange, emit, log, flash,
    power, key, bedside, pending, currentRate, drugLabel, hasDose, doseUnit,
  };
})();
