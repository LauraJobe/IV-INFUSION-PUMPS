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
  const doseUnit = (p) => (!p || !p.drug ? "ML/HR" : isInt(p) ? U(p.drug.dose.unit) : U(doseUnitLabel(p.drug)));
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
  const volFor = (d) => (isInt(d) && d.dose ? r3(d.dose / (concOf(d).amt / concOf(d).vol)) : null);

  function recalc(d) {
    if (isInt(d)) {
      const v = volFor(d);
      d.vtbi = v;
      d.rate = v && d.time ? r2(v / (d.time / 60)) : null;
    } else if (d.dose != null && d.weight) d.rate = r2(doseToRate(d.drug, concOf(d), d.dose, d.weight));
  }
  const syringeFor = (d) => SIZES.find((s) => s >= (isInt(d) ? d.vtbi || 1 : 50)) || 60;

  // "30" = 30 min, "130" = 1 h 30 min
  function parseTime(buf) {
    const dg = buf.replace(/\D/g, "");
    if (!dg) return NaN;
    return dg.length <= 2 ? +dg : +dg.slice(0, -2) * 60 + +dg.slice(-2);
  }
  const fmtTime = (m) => (m == null ? "--:--:--" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}:${String(Math.round((m * 60) % 60)).padStart(2, "0")}`);

  // Limit check: continuous = dose; intermittent = dose per kg per dose.
  function limitCheck(d, dose) {
    const l = d.drug.limits;
    const v = isInt(d) ? dose / d.weight : dose;
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
      S.draft = { drug, drugId: drug.id, weight: S.weight, dose: null, time: null, rate: null, vtbi: null, overrides: [], field: "weight" };
      if (drug.highAlert) return go("advisory");
      return go("params");
    }
  }

  function fields(d) { return isInt(d) ? ["weight", "dose", "time"] : ["weight", "dose"]; }

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
    if (sc.id === "advisory") { if (k === "ENTER") go("params"); return; }
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
    if (["advisory", "params"].includes(sc.id)) {
      if (sc.id === "params") { const d = S.draft, i = fields(d).indexOf(d.field); if (i > 0) { d.field = fields(d)[i - 1]; return emit(); } }
      return go("program", { list: programList(S.draft.drug.syrCat), page: 0, cat: S.draft.drug.syrCat });
    }
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
      } else d.time = v;
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
      p.dose = sc.pending; p.rate = r2(doseToRate(p.drug, concOf(p), p.dose, p.weight));
      p.overrides = S.draft.overrides.slice();
      log("titrate", { ch: "A", drugId: p.drugId, fromDose: from.dose, toDose: p.dose, fromRate: from.rate, toRate: p.rate, state: c.state });
      return go("run");
    }
    if (c.state === "paused" && c.primary) { c.state = "running"; log("resume", { ch: "A", fromAlarm: null }); return go("run"); }
    if (["params", "load", "prime"].includes(sc.id)) { flash("FINISH PROGRAMMING FIRST", "warn"); return emit(); }
  }

  function startInfusion() {
    const d = S.draft, c = ch();
    const prog = { mode: "guardrails", drugId: d.drugId, drug: d.drug, conc: concOf(d), dose: d.dose, rate: d.rate, vtbi: d.vtbi, time: d.time, remaining: isInt(d) ? d.vtbi : 50, given: 0, weight: d.weight, overrides: d.overrides.slice(), syringe: syringeFor(d), int: isInt(d) };
    c.primary = prog; c.state = "running"; c.alarm = null;
    log("start", { ch: "A", drugId: d.drugId, mode: "guardrails", profile: S.profile, concVol: concOf(d).vol, concAmt: concOf(d).amt, dose: d.dose, rate: d.rate, vtbi: d.vtbi, time: d.time, weight: d.weight, overrides: d.overrides.length, traced: true });
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
    const c = concOf(d);
    const rows = [
      { k: "CONC", v: concText(d.drug) },
      { k: "WEIGHT", v: `${val("weight", d.weight, (x) => fmtNum(x, 3))} KG`, on: active === "weight" },
      { k: "DOSE", v: `${val("dose", d.dose, (x) => fmtNum(x, 3))} ${doseUnit(d)}`, on: active === "dose", big: true, rev: d.overrides.length > 0 },
    ];
    if (isInt(d)) rows.push({ k: "TIME", v: val("time", d.time, fmtTime), on: active === "time" });
    rows.push({ k: "RATE", v: d.rate != null ? `${fmtNum(d.rate, 3)} ML/HR` : "--- ML/HR" });
    if (isInt(d) && d.vtbi != null) rows.push({ k: "VOLUME", v: `${fmtNum(d.vtbi, 3)} ML` });
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
      case "advisory": return Object.assign(base, { title: d.drug.prog, msg: "HIGH ALERT MEDICATION<br>INDEPENDENT DOUBLE CHECK", prompt: "PRESS ENTER TO CONTINUE" });
      case "params": {
        const f = d.field;
        const ask = { weight: "ENTER WEIGHT (KG)", dose: isInt(d) ? `ENTER DOSE (${U(d.drug.dose.unit)})` : `ENTER DOSE (${doseUnit(d)})`, time: "ENTER TIME (30 = 30 MIN, 100 = 1 HR)" }[f];
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
        { k: "NEW RATE", v: sc.pending != null ? `${fmtNum(r2(doseToRate(c.primary.drug, concOf(c.primary), sc.pending, c.primary.weight)), 3)} ML/HR` : "---" }],
        prompt: sc.pending != null ? "PRESS <START> TO CONFIRM NEW DOSE" : "ENTER NEW DOSE - PRESS ENTER", soft: [K("CANCEL", () => go("run")), null, null, null] });
      case "run": return runSpec(base);
    }
    return base;
  }

  function options() { flash("OPTIONS ARE NOT USED IN PRACTICE"); emit(); }

  function runSpec(base) {
    const c = ch(), p = c.primary;
    if (!p) return base;
    const rows = [
      { k: "CONC", v: concText(p.drug) },
      { k: "TVD", v: `${fmtNum(c.vi, 3)} ML` },
      { k: "WEIGHT", v: `${fmtNum(p.weight, 3)} KG` },
      { k: "DOSE", v: `${fmtNum(p.dose, 3)} ${doseUnit(p)}`, big: true, rev: p.overrides.length > 0 },
      { k: "RATE", v: `${fmtNum(p.rate, 3)} ML/HR` },
    ];
    if (p.int) rows.push({ k: "TIME REMAINING", v: fmtTime(p.rate ? (p.remaining / p.rate) * 60 : 0) });
    const running = c.state === "running";
    return Object.assign(base, {
      title: p.drug.prog, rows, running, alarm: c.alarm,
      prompt: c.state === "paused" ? "PAUSED - PRESS <START> TO RESUME" : c.state === "complete" ? "PRESS STOP TO CLEAR" : "",
      soft: running ? [K("LOCK", () => { flash("KEYPAD LOCK IS NOT USED IN PRACTICE"); emit(); }), p.int ? null : K("CHG DOSE", chgDose), K("OPTIONS", options), K("CLEAR TVD", () => { c.vi = 0; log("clearVolume"); emit(); })]
        : [K("MAIN MENU", () => { c.primary = null; c.state = "idle"; go("profile", { list: profileList(), page: 0 }); }), p.int ? null : K("CHG DOSE", chgDose), K("OPTIONS", options), K("CLEAR TOTALS", () => { c.vi = 0; log("clearVolume"); emit(); })],
    });
  }

  function chgDose() {
    const p = ch().primary;
    S.draft = { drug: p.drug, drugId: p.drugId, weight: p.weight, dose: p.dose, overrides: p.overrides.slice(), field: "dose" };
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
      ch().primary = { mode: "guardrails", drugId: a.drugId, drug, conc, dose: a.dose, rate, vtbi: 50, remaining: 30, given: 20, weight: S.weight, overrides: [], syringe: 60, int: false };
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
