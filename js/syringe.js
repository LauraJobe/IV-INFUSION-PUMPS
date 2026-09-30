/*
 * Syringe pump simulator, modeled on the Medfusion 3500 (v5) Quick Reference
 * Card: Power -> self test -> Select Profile -> Select Category -> Select Drug
 * Program -> program the parameters -> load syringe -> prime -> confirm ->
 * START. Menus are picked by pressing the item's number. Numbers are typed
 * on the keypad and confirmed with ENTER. For education only: not the
 * manufacturer's software.
 *
 * It exposes the same state shape and log events as the other pumps so
 * practice mode, the check-off and grading are shared.
 */

const Syringe = (() => {
  const BOOT_MS = 3000;
  const SIZES = [3, 5, 10, 20, 30, 60];
  const PER_PAGE = 8;
  let S;
  const listeners = [];
  // Last program per drug ("Recall last settings"); kept like the pump's memory.
  const lastSettings = {};
  let bootTimer = null;

  function newBedside() {
    return { primed: false, loaded: false, traced: false, clampOpen: false, occluded: false, air: false, primaryBag: 0, primaryBagName: "", secondaryHung: false, secondaryClampOpen: false, secondaryBag: 0, secondaryBagName: "" };
  }
  function newChannel(id) { return { id, state: "idle", primary: null, secondary: null, onSecondary: false, vi: 0, alarm: null, bedside: newBedside() }; }

  function reset() {
    clearTimeout(bootTimer);
    S = {
      on: false, t: 0, profile: null, weight: null, patientId: null,
      channels: { A: newChannel("A"), B: newChannel("B") },
      screen: { id: "off" }, spec: null, buffer: "", draft: null,
      silencedUntil: 0, flash: null, log: [],
    };
    emit();
  }

  const log = (type, data = {}) => S.log.push(Object.assign({ t: S.t, type, pump: "syr" }, data));
  const onChange = (fn) => listeners.push(fn);
  function emit() { listeners.forEach((fn) => fn(S)); }
  function flash(text, kind = "info") { S.flash = { text, kind, until: Date.now() + 3200 }; }
  function go(id, ctx = {}) { S.screen = Object.assign({}, ctx, { id }); S.buffer = ""; emit(); }
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const ch = () => S.channels.A;
  const U = (s) => String(s).toUpperCase();

  // ------------------------------------------------------------ math
  const isInt = (d) => d.drug.mode === "int";
  // Infusion modes chosen after the drug program: mL/hr, volume/time,
  // dose/time (no weight) or dose/kg (weight based).
  const MODES = ["mlhr", "voltime", "dose", "dosekg"];
  function modeLabel(pm, drug) {
    if (pm === "mlhr") return "ML/HR";
    if (pm === "voltime") return "VOLUME/TIME";
    if (pm === "dose") return "DOSE/TIME";
    return drug.mode === "int" ? "DOSE/KG" : `DOSE/KG/${drug.dose.time === "min" ? "MIN" : "HR"}`;
  }
  const isDoseMode = (d) => d.pm === "dose" || d.pm === "dosekg";
  // The drug as dosed in the chosen mode (dose/time drops the per-kg part).
  const effDrug = (d) => (d.pm === "dose" && !isInt(d) ? { dose: Object.assign({}, d.drug.dose, { perKg: false }) } : d.drug);
  function doseUnit(p) {
    if (!p || !p.drug || !isDoseMode(p)) return "ML/HR";
    if (isInt(p)) return p.pm === "dosekg" ? `${U(p.drug.dose.unit)}/KG` : U(p.drug.dose.unit);
    return U(doseUnitLabel(effDrug(p)));
  }
  const hasDose = (p) => !!(p && p.drug);
  const drugLabel = (p) => (p && p.drug ? p.drug.prog : "");
  const concOf = (d) => d.drug.concs[0];
  // Concentration per mL in the dose's unit (20 MCG/ML, not 0.02 MG/ML).
  function concText(drug) {
    const c = drug.concs[0], u = drug.dose.unit;
    const same = UNIT_FACTORS[u] != null && UNIT_FACTORS[c.unit] != null && (u === c.unit || ["mg", "mcg", "g"].includes(u) === ["mg", "mcg", "g"].includes(c.unit));
    const per = same ? (c.amt * UNIT_FACTORS[c.unit]) / UNIT_FACTORS[u] / c.vol : c.amt / c.vol;
    return `${fmtNum(per, 3)} ${U(same ? u : c.unit)}/ML`;
  }
  // Total amount for an intermittent dose (dose/kg mode multiplies by weight).
  const totalDose = (d) => (d.dose == null ? null : d.pm === "dosekg" && isInt(d) ? r3(d.dose * d.weight) : d.dose);
  const perMl = (d) => concOf(d).amt / concOf(d).vol;

  function recalc(d) {
    if (d.pm === "mlhr") return;
    if (d.pm === "voltime") { d.rate = d.vtbi && d.time ? r2(d.vtbi / (d.time / 60)) : null; return; }
    if (isInt(d)) {
      const t = totalDose(d);
      d.vtbi = t ? r3(t / perMl(d)) : null;
      d.rate = d.vtbi && d.time ? r2(d.vtbi / (d.time / 60)) : null;
    } else if (d.dose != null && (d.pm === "dose" || d.weight)) d.rate = r2(doseToRate(effDrug(d), concOf(d), d.dose, d.weight));
  }
  const syringeFor = (d) => SIZES.find((s) => s >= (d.vtbi && (isInt(d) || d.pm === "voltime") ? d.vtbi : 50)) || 60;

  // "30" = 30 min, "130" = 1 h 30 min
  function parseTime(buf) {
    const dg = buf.replace(/\D/g, "");
    if (!dg) return NaN;
    return dg.length <= 2 ? +dg : +dg.slice(0, -2) * 60 + +dg.slice(-2);
  }
  const fmtTime = (m) => (m == null ? "--:--:--" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}:${String(Math.round((m * 60) % 60)).padStart(2, "0")}`);

  // Limit check (dose modes only): continuous limits are per kg per time,
  // intermittent limits per kg per dose. Without a weight they cannot apply.
  function limitCheck(d, dose) {
    const l = d.drug.limits;
    if (!isDoseMode(d)) return null;
    if (d.pm === "dose" && !isInt(d)) return null;
    if (d.pm === "dose" && isInt(d) && !d.weight) return null;
    const v = isInt(d) ? (d.pm === "dosekg" ? dose : dose / d.weight) : dose;
    const unit = isInt(d) ? `${U(d.drug.dose.unit)}/KG` : doseUnit(d);
    if (l.hardMax != null && v > l.hardMax + 1e-9) return { kind: "hard", dir: "max", v, limit: l.hardMax, unit };
    if (l.hardMin != null && v < l.hardMin - 1e-9) return { kind: "hard", dir: "min", v, limit: l.hardMin, unit };
    const done = (dir) => d.overrides.some((o) => o.dir === dir && Math.abs(o.dose - dose) < 1e-9);
    if (l.softMax != null && v > l.softMax + 1e-9 && !done("max")) return { kind: "soft", dir: "max", v, limit: l.softMax, unit };
    if (l.softMin != null && v < l.softMin - 1e-9 && !done("min")) return { kind: "soft", dir: "min", v, limit: l.softMin, unit };
    return null;
  }

  // ------------------------------------------------------------ menus
  const profileList = () => Object.keys(SYR_PROFILES).map((pid) => ({ label: SYR_PROFILES[pid].name, pid }));
  function categoryList() {
    const cats = [];
    SYR_PROFILES[S.profile].drugs.forEach((id) => { const c = SYR_DRUGS[id].syrCat; if (!cats.includes(c)) cats.push(c); });
    return cats.sort().map((c) => ({ label: c, cat: c }));
  }
  const programList = (cat) => SYR_PROFILES[S.profile].drugs.filter((id) => SYR_DRUGS[id].syrCat === cat).map((id) => ({ label: SYR_DRUGS[id].prog, drug: SYR_DRUGS[id] }));

  function pickNumber(n) {
    const sc = S.screen, idx = sc.page * PER_PAGE + n - 1;
    const it = sc.list[idx];
    if (!it) return;
    if (sc.id === "profile") { S.profile = it.pid; log("profile", { profile: it.pid }); return go("category", { list: categoryList(), page: 0 }); }
    if (sc.id === "category") return go("program", { list: programList(it.cat), page: 0, cat: it.cat });
    if (sc.id === "program") {
      const drug = it.drug;
      log("drugSelected", { ch: "A", drugId: drug.id, conc: concLabel(drug, concOf({ drug })), secondary: false });
      S.draft = { drug, drugId: drug.id, pm: null, weight: S.weight, dose: null, time: null, rate: null, vtbi: null, overrides: [], field: null };
      if (drug.highAlert) return go("advisory");
      return toModes();
    }
    if (sc.id === "mode") {
      const d = S.draft;
      if (it.recall) {
        const last = lastSettings[d.drugId];
        if (!last) { flash("NO SETTINGS TO RECALL FOR THIS DRUG", "warn"); return emit(); }
        Object.assign(d, JSON.parse(JSON.stringify(last)), { drug: d.drug, overrides: [] });
        if (d.weight) S.weight = d.weight;
        log("recall", { ch: "A", drugId: d.drugId, pm: d.pm });
        return go("load");
      }
      Object.assign(d, { pm: it.pm, dose: null, time: null, rate: null, vtbi: null });
      d.field = fields(d)[0];
      log("syrMode", { ch: "A", pm: it.pm });
      return go("params");
    }
  }

  function toModes() {
    const d = S.draft;
    go("mode", { list: MODES.map((pm) => ({ label: modeLabel(pm, d.drug), pm })).concat([{ label: "RECALL LAST SETTINGS", recall: true }]), page: 0 });
  }

  function fields(d) {
    if (d.pm === "mlhr") return ["rate"];
    if (d.pm === "voltime") return ["vtbi", "time"];
    const f = d.pm === "dosekg" ? ["weight", "dose"] : ["dose"];
    if (isInt(d)) f.push("time");
    return f;
  }

  // ------------------------------------------------------------ keys
  function power() {
    if (!S.on) {
      S.on = true; log("powerOn"); go("boot");
      bootTimer = setTimeout(() => { if (S.screen.id === "boot") go("profile", { list: profileList(), page: 0 }); }, BOOT_MS);
      return;
    }
    if (ch().state === "running") { flash("STOP THE INFUSION BEFORE POWER OFF", "warn"); return emit(); }
    clearTimeout(bootTimer); S.on = false; log("powerOff"); go("off");
  }

  function key(k) {
    if (!S.on || S.screen.id === "boot") return;
    const sc = S.screen, c = ch();
    if (k === "SILENCE") { S.silencedUntil = Date.now() + 120000; log("silence"); return emit(); }
    if (k === "BOLUS") { flash("BOLUS IS NOT USED IN PRACTICE"); return emit(); }
    if (k === "STOP") {
      if (c.state === "running") { c.state = "paused"; log("pause", { ch: "A" }); return go("run"); }
      if (c.state === "complete") { c.alarm = null; c.state = "idle"; return go("profile", { list: profileList(), page: 0 }); }
      return;
    }
    if (k === "START") return startKey();
    if (k === "BACK") return back();
    if (/^[0-9]$/.test(k) && sc.list) { if (+k >= 1) pickNumber(+k); return; }
    if (sc.id === "advisory") { if (k === "ENTER") toModes(); return; }
    if (sc.id === "load") { if (k === "ENTER") { log("bedside", { ch: "A", action: "load" }); go("prime"); } return; }
    if (sc.id === "params" || sc.id === "chgDose") {
      if (/^[0-9.]$/.test(k)) {
        const f = sc.id === "chgDose" ? "dose" : S.draft.field;
        if (k === "." && (S.buffer.includes(".") || f === "time")) return;
        if (S.buffer.length >= 7) return;
        S.buffer += k; return emit();
      }
      if (k === "ENTER") return sc.id === "chgDose" ? enterChange() : enterField();
    }
  }

  function back() {
    const sc = S.screen;
    if (S.buffer) { S.buffer = ""; return emit(); }
    if (sc.id === "category") return go("profile", { list: profileList(), page: 0 });
    if (sc.id === "program") return go("category", { list: categoryList(), page: 0 });
    if (sc.id === "params") { const d = S.draft, i = fields(d).indexOf(d.field); if (i > 0) { d.field = fields(d)[i - 1]; return emit(); } return toModes(); }
    if (["advisory", "mode"].includes(sc.id)) return go("program", { list: programList(S.draft.drug.syrCat), page: 0, cat: S.draft.drug.syrCat });
    if (["load", "prime", "ready"].includes(sc.id)) { S.draft.field = fields(S.draft).slice(-1)[0]; return go("params"); }
    if (sc.id === "chgDose") return go("run");
    if (sc.id === "run") { flash(`PVD ${fmtNum(ch().primary ? ch().primary.given : 0, 3)} ML`); return emit(); }
  }

  function enterField() {
    const d = S.draft, f = d.field;
    if (S.buffer === "" && d[f] == null) { flash("ENTER A VALUE", "warn"); return emit(); }
    if (S.buffer !== "") {
      const v = f === "time" ? parseTime(S.buffer) : parseFloat(S.buffer);
      S.buffer = "";
      if (isNaN(v) || v <= 0) { flash("INVALID ENTRY", "warn"); return emit(); }
      if (f === "weight") { S.weight = v; d.weight = v; log("weight", { kg: v }); }
      else if (f === "dose") {
        const lim = limitCheck(d, v);
        if (lim) return limitScreen(lim, v, "params");
        d.dose = v;
      } else d[f] = v;
      recalc(d);
    }
    const fs = fields(d), i = fs.indexOf(f);
    if (i < fs.length - 1) { d.field = fs[i + 1]; return emit(); }
    go("load");
  }

  function limitScreen(lim, dose, back) {
    const d = S.draft;
    log(lim.kind === "hard" ? "hardLimit" : "softLimit", { ch: "A", drugId: d.drugId, val: dose, limit: lim.limit, dir: lim.dir });
    go(lim.kind === "hard" ? "hardMsg" : "softMsg", { lim, dose, back });
  }

  function acceptDose(dose, back) {
    const d = S.draft;
    d.dose = dose; recalc(d);
    if (back === "chgDose") return go("chgDose", { pending: dose });
    const fs = fields(d), i = fs.indexOf("dose");
    if (i < fs.length - 1) { d.field = fs[i + 1]; return go("params"); }
    go("load");
  }

  function enterChange() {
    const d = S.draft;
    if (S.buffer === "") return;
    const v = parseFloat(S.buffer);
    S.buffer = "";
    if (isNaN(v) || v <= 0) { flash("INVALID ENTRY", "warn"); return emit(); }
    const lim = limitCheck(d, v);
    if (lim) return limitScreen(lim, v, "chgDose");
    go("chgDose", { pending: v });
  }

  function startKey() {
    const sc = S.screen, c = ch();
    if (sc.id === "ready") return startInfusion();
    if (sc.id === "chgDose" && sc.pending != null) {
      const p = c.primary, from = { dose: p.dose, rate: p.rate };
      p.dose = sc.pending; p.rate = r2(doseToRate(effDrug(p), concOf(p), p.dose, p.weight));
      p.overrides = S.draft.overrides.slice();
      log("titrate", { ch: "A", drugId: p.drugId, fromDose: from.dose, toDose: p.dose, fromRate: from.rate, toRate: p.rate, state: c.state });
      return go("run");
    }
    if (c.state === "paused" && c.primary) { c.state = "running"; log("resume", { ch: "A", fromAlarm: null }); return go("run"); }
    if (["params", "load", "prime"].includes(sc.id)) { flash("FINISH PROGRAMMING FIRST", "warn"); return emit(); }
  }

  function startInfusion() {
    const d = S.draft, c = ch();
    const finite = isInt(d) || d.pm === "voltime";
    const prog = { mode: "guardrails", pm: d.pm, drugId: d.drugId, drug: d.drug, conc: concOf(d), dose: d.dose, rate: d.rate, vtbi: d.vtbi, time: d.time, remaining: finite ? d.vtbi : 50, given: 0, weight: d.weight, overrides: d.overrides.slice(), syringe: syringeFor(d), int: finite };
    c.primary = prog; c.state = "running"; c.alarm = null;
    lastSettings[d.drugId] = { pm: d.pm, weight: d.weight, dose: d.dose, time: d.time, rate: d.rate, vtbi: d.vtbi, drugId: d.drugId };
    log("start", { ch: "A", drugId: d.drugId, mode: "guardrails", pm: d.pm, profile: S.profile, concVol: concOf(d).vol, concAmt: concOf(d).amt, dose: d.dose, total: isInt(d) && isDoseMode(d) ? totalDose(d) : null, rate: d.rate, vtbi: d.vtbi, time: d.time, weight: d.pm === "dosekg" ? d.weight : null, overrides: d.overrides.length, traced: true });
    go("run");
  }

  function softKey(side, i) {
    if (!S.on || !S.spec) return;
    const k = S.spec.soft[i];
    if (k && k.fn) k.fn();
  }

  // ------------------------------------------------------------ running
  function tick(dt) {
    if (!S.on || S.screen.id === "boot") return;
    S.t += dt;
    const c = ch(), p = c.primary;
    if (p && c.state === "running") {
      const v = Math.min(p.rate * dt / 3600, p.remaining);
      p.remaining -= v; p.given += v; c.vi += v;
      if (p.remaining <= 0.00001) {
        c.state = "complete"; c.alarm = { type: "complete", msg: p.int ? "INFUSION COMPLETE" : "SYRINGE EMPTY", level: "high" };
        S.silencedUntil = 0; log("alarm", { ch: "A", alarm: "complete" }); log("complete", { ch: "A" });
      }
    }
    emit();
  }
  function currentRate(c) { return c.state === "running" && c.primary ? c.primary.rate : 0; }

  // ------------------------------------------------------------ screens
  const K = (label, fn) => ({ label, fn });
  const pageKey = () => K("MORE", () => { const sc = S.screen; const pages = Math.ceil(sc.list.length / PER_PAGE); sc.page = (sc.page + 1) % pages; emit(); });

  function menuSpec(title, extraSoft) {
    const sc = S.screen;
    const items = sc.list.slice(sc.page * PER_PAGE, sc.page * PER_PAGE + PER_PAGE).map((it, i) => ({ n: i + 1, label: it.label }));
    const more = sc.list.length > PER_PAGE;
    return { menu: items, prompt: title, soft: [extraSoft || null, null, null, more ? pageKey() : null], page: more ? `${sc.page + 1}/${Math.ceil(sc.list.length / PER_PAGE)}` : "" };
  }

  function rowsFor(d, active) {
    const val = (f, v, fmt) => (active === f && S.buffer !== "" ? (f === "time" ? fmtTime(parseTime(S.buffer)) : S.buffer) : v == null ? "---" : fmt(v));
    const n3 = (x) => fmtNum(x, 3);
    const rows = [{ k: "CONC", v: concText(d.drug) }, { k: "MODE", v: modeLabel(d.pm, d.drug) }];
    if (d.pm === "mlhr") { rows.push({ k: "RATE", v: `${val("rate", d.rate, n3)} ML/HR`, on: active === "rate", big: true }); return rows; }
    if (d.pm === "voltime") {
      rows.push({ k: "VOLUME", v: `${val("vtbi", d.vtbi, n3)} ML`, on: active === "vtbi" }, { k: "TIME", v: val("time", d.time, fmtTime), on: active === "time" },
        { k: "RATE", v: d.rate != null ? `${n3(d.rate)} ML/HR` : "--- ML/HR", big: true });
      return rows;
    }
    if (d.pm === "dosekg") rows.push({ k: "WEIGHT", v: `${val("weight", d.weight, n3)} KG`, on: active === "weight" });
    rows.push({ k: "DOSE", v: `${val("dose", d.dose, n3)} ${doseUnit(d)}`, on: active === "dose", big: true, rev: d.overrides.length > 0 });
    if (isInt(d)) {
      rows.push({ k: "TIME", v: val("time", d.time, fmtTime), on: active === "time" });
      if (d.pm === "dosekg" && d.dose != null && d.weight) rows.push({ k: "TOTAL", v: `${n3(totalDose(d))} ${U(d.drug.dose.unit)}` });
    }
    rows.push({ k: "RATE", v: d.rate != null ? `${n3(d.rate)} ML/HR` : "--- ML/HR" });
    if (isInt(d) && d.vtbi != null) rows.push({ k: "VOLUME", v: `${n3(d.vtbi)} ML` });
    return rows;
  }

  function spec() {
    const sc = S.screen, c = ch(), d = S.draft;
    const base = { title: "", unit: S.profile ? SYR_PROFILES[S.profile].unit.toUpperCase() : "", prompt: "", soft: [null, null, null, null] };
    switch (sc.id) {
      case "off": return { off: true };
      case "boot": return { boot: true };
      case "profile": return Object.assign(base, { title: "SELECT PROFILE", unit: "" }, menuSpec("PRESS THE NUMBER TO SELECT"));
      case "category": return Object.assign(base, { title: SYR_PROFILES[S.profile].name }, menuSpec("PRESS THE NUMBER TO SELECT", K("CHG PROFILE", () => go("profile", { list: profileList(), page: 0 }))));
      case "program": return Object.assign(base, { title: sc.cat }, menuSpec("PRESS THE NUMBER TO SELECT", K("CHG PROFILE", () => go("profile", { list: profileList(), page: 0 }))));
      case "mode": return Object.assign(base, { title: d.drug.prog }, menuSpec("SELECT INFUSION MODE - PRESS THE NUMBER"));
      case "advisory": return Object.assign(base, { title: d.drug.prog, msg: "HIGH ALERT MEDICATION<br>INDEPENDENT DOUBLE CHECK", prompt: "PRESS ENTER TO CONTINUE" });
      case "params": {
        const f = d.field;
        const ask = { weight: "ENTER WEIGHT (KG)", dose: `ENTER DOSE (${doseUnit(d)})`, time: "ENTER TIME (30 = 30 MIN, 100 = 1 HR)", rate: "ENTER RATE (ML/HR)", vtbi: "ENTER VOLUME (ML)" }[f];
        return Object.assign(base, { title: d.drug.prog, rows: rowsFor(d, f), prompt: `${ask} - PRESS ENTER` });
      }
      case "softMsg": return Object.assign(base, { title: d.drug.prog, msg: `DOSE ${sc.lim.dir === "max" ? "ABOVE" : "BELOW"} SOFT LIMIT<br>${fmtNum(sc.lim.v, 3)} ${sc.lim.unit} (LIMIT ${fmtNum(sc.lim.limit, 3)})<br>OVERRIDE?`, alert: "soft",
        soft: [K("YES", () => { d.overrides.push({ dir: sc.lim.dir, dose: sc.dose }); log("override", { ch: "A", drugId: d.drugId, val: sc.dose, dir: sc.lim.dir }); acceptDose(sc.dose, sc.back); }), null, null,
          K("NO", () => { log("softReenter", { ch: "A" }); if (sc.back === "chgDose") return go("chgDose"); d.field = "dose"; go("params"); })] });
      case "hardMsg": return Object.assign(base, { title: d.drug.prog, msg: `DOSE ${sc.lim.dir === "max" ? "ABOVE" : "BELOW"} HARD LIMIT<br>${fmtNum(sc.lim.v, 3)} ${sc.lim.unit}<br>${sc.lim.dir === "max" ? "MAXIMUM" : "MINIMUM"} ${fmtNum(sc.lim.limit, 3)} ${sc.lim.unit}`, alert: "hard",
        soft: [null, null, null, K("OK", () => { if (sc.back === "chgDose") return go("chgDose"); d.field = "dose"; go("params"); })] });
      case "load": return Object.assign(base, { title: d.drug.prog, msg: `LOAD SYRINGE - PRESS ENTER WHEN READY<br><b class="sy-size">B-D ${syringeFor(d)} ML</b>`, prompt: "VERIFY SYRINGE MODEL AND SIZE" });
      case "prime": return Object.assign(base, { title: d.drug.prog, msg: "PRIME THE TUBING?<br>DISCONNECT FROM PATIENT BEFORE PRIMING",
        soft: [K("PRIME", () => { log("bedside", { ch: "A", action: "prime" }); flash("TUBING PRIMED"); go("ready"); }), null, null, K("SKIP", () => go("ready"))] });
      case "ready": return Object.assign(base, { title: d.drug.prog, rows: rowsFor(d, null), prompt: "PRESS <START> KEY TO BEGIN INFUSION", soft: [K("MAIN MENU", () => go("profile", { list: profileList(), page: 0 })), null, K("OPTIONS", options), null] });
      case "chgDose": return Object.assign(base, { title: c.primary.drug.prog, rows: [{ k: "CURRENT", v: `${fmtNum(c.primary.dose, 3)} ${doseUnit(c.primary)}` }, { k: "NEW DOSE", v: `${S.buffer !== "" ? S.buffer : sc.pending != null ? fmtNum(sc.pending, 3) : "---"} ${doseUnit(c.primary)}`, on: sc.pending == null, big: true },
        { k: "NEW RATE", v: sc.pending != null ? `${fmtNum(r2(doseToRate(effDrug(c.primary), concOf(c.primary), sc.pending, c.primary.weight)), 3)} ML/HR` : "---" }],
        prompt: sc.pending != null ? "PRESS <START> TO CONFIRM NEW DOSE" : "ENTER NEW DOSE - PRESS ENTER", soft: [K("CANCEL", () => go("run")), null, null, null] });
      case "run": return runSpec(base);
    }
    return base;
  }

  function options() { flash("OPTIONS ARE NOT USED IN PRACTICE"); emit(); }

  function runSpec(base) {
    const c = ch(), p = c.primary;
    if (!p) return base;
    const dm = isDoseMode(p);
    const rows = [{ k: "CONC", v: concText(p.drug) }, { k: "TVD", v: `${fmtNum(c.vi, 3)} ML` }];
    if (p.pm === "dosekg") rows.push({ k: "WEIGHT", v: `${fmtNum(p.weight, 3)} KG` });
    else rows.push({ k: "MODE", v: modeLabel(p.pm, p.drug) });
    if (dm) rows.push({ k: "DOSE", v: `${fmtNum(p.dose, 3)} ${doseUnit(p)}`, big: true, rev: p.overrides.length > 0 }, { k: "RATE", v: `${fmtNum(p.rate, 3)} ML/HR` });
    else rows.push({ k: "RATE", v: `${fmtNum(p.rate, 3)} ML/HR`, big: true });
    if (p.int) rows.push({ k: "TIME REMAINING", v: fmtTime(p.rate ? (p.remaining / p.rate) * 60 : 0) });
    const running = c.state === "running";
    return Object.assign(base, {
      title: p.drug.prog, rows, running, alarm: c.alarm,
      prompt: c.state === "paused" ? "PAUSED - PRESS <START> TO RESUME" : c.state === "complete" ? "PRESS STOP TO CLEAR" : "",
      soft: running ? [K("LOCK", () => { flash("KEYPAD LOCK IS NOT USED IN PRACTICE"); emit(); }), p.int || !dm ? null : K("CHG DOSE", chgDose), K("OPTIONS", options), K("CLEAR TVD", () => { c.vi = 0; log("clearVolume"); emit(); })]
        : [K("MAIN MENU", () => { c.primary = null; c.state = "idle"; go("profile", { list: profileList(), page: 0 }); }), p.int || !dm ? null : K("CHG DOSE", chgDose), K("OPTIONS", options), K("CLEAR TOTALS", () => { c.vi = 0; log("clearVolume"); emit(); })],
    });
  }

  function chgDose() {
    const p = ch().primary;
    S.draft = { drug: p.drug, drugId: p.drugId, pm: p.pm, weight: p.weight, dose: p.dose, overrides: p.overrides.slice(), field: "dose" };
    go("chgDose", { pending: null });
  }

  function render() {
    if (S.flash && Date.now() > S.flash.until) S.flash = null;
    S.spec = spec();
    return S.spec;
  }

  function pending() {
    const sc = S.screen;
    if (["advisory", "params", "softMsg", "hardMsg", "load", "prime", "ready"].includes(sc.id)) return true;
    return sc.id === "chgDose" && (S.buffer !== "" || sc.pending != null);
  }

  function bedside(chId, action) { log("bedside", { ch: chId, action }); emit(); }

  // Practice setup: pump on at Select Profile, or a drip already running (titration).
  function preset(cfg) {
    reset();
    S.on = true; S.patientId = cfg.patientId || null;
    const a = (cfg.channels || []).find((x) => x.ch === "A");
    if (a && a.drugId && SYR_DRUGS[a.drugId]) {
      const drug = SYR_DRUGS[a.drugId], conc = drug.concs[0];
      S.profile = cfg.profile; S.weight = cfg.weight;
      const rate = r2(doseToRate(drug, conc, a.dose, S.weight));
      ch().primary = { mode: "guardrails", pm: "dosekg", drugId: a.drugId, drug, conc, dose: a.dose, rate, vtbi: 50, remaining: 30, given: 20, weight: S.weight, overrides: [], syringe: 60, int: false };
      ch().state = "running";
      S.screen = { id: "run" };
    } else S.screen = { id: "profile", list: profileList(), page: 0 };
    emit();
  }

  reset();
  return {
    get state() { return S; }, reset, preset, tick, render, onChange, emit, log, flash,
    power, key, softKey, bedside, pending, currentRate, drugLabel, hasDose, doseUnit,
  };
})();
