/*
 * Dual-line cassette pump simulator, modeled on the programming workflow in
 * the Hospira Plum A+ operator manual: one cassette with Line A (primary)
 * and Line B (piggyback or concurrent), a monochrome screen with four soft
 * keys under it, START / STOP / ON-OFF, SELECT up/down, CLEAR and SILENCE.
 * This model has a drug NAME list but no dose limits: the nurse types the
 * concentration and weight for Dose Calculation. For education only: not the
 * manufacturer's software.
 *
 * It exposes the same state shape and log events as the other pumps so
 * practice mode, the check-off and grading are shared.
 */

const Plum = (() => {
  const BOOT_MS = 3000;
  const LINES = ["A", "B"];
  // Dose units in the order the pump lists them.
  const DOSE_UNITS = ["mL/hr", "mcg/kg/min", "mcg/kg/hr", "mcg/min", "mcg/hr", "mg/kg/hr", "mg/min", "mg/hr",
    "grams/hr", "ng/kg/min", "units/kg/hr", "units/min", "units/hr", "mUn/min", "mEq/hr"];
  const NAME_TO_UNIT = { grams: "g", mUn: "milliunits", ng: "ng", mcg: "mcg", mg: "mg", units: "units", mEq: "mEq" };
  const UNIT_TO_NAME = { g: "grams", milliunits: "mUn", ng: "ng", mcg: "mcg", mg: "mg", units: "units", mEq: "mEq" };
  const FAMILY = { mcg: "mass", mg: "mass", grams: "mass", ng: "mass", units: "units", mUn: "units", mEq: "mEq" };
  const CONC_UNITS = { mass: ["mcg", "mg", "grams"], units: ["units"], mEq: ["mEq"] };
  const THERAPIES = ["Dose Calculation", "Loading Dose", "Multistep"];
  const PAGE = 7;

  let S;
  const listeners = [];
  let bootTimer = null;

  function newBedside() {
    return { primed: false, loaded: false, traced: false, clampOpen: false, occluded: false, air: false, primaryBag: 0, primaryBagName: "", secondaryHung: false, secondaryClampOpen: false, secondaryBag: 0, secondaryBagName: "" };
  }
  function newLine(id) {
    return { id, state: "idle", primary: null, secondary: null, onSecondary: false, vi: 0, alarm: null, bedside: newBedside(), mode: id === "B" ? "Piggyback" : null };
  }

  function reset() {
    clearTimeout(bootTimer);
    S = {
      on: false, t: 0, profile: null, weight: null, patientId: null,
      channels: { A: newLine("A"), B: newLine("B") },
      screen: { id: "off" }, spec: null, buffer: "",
      silencedUntil: 0, flash: null, log: [],
    };
    emit();
  }

  const log = (type, data = {}) => S.log.push(Object.assign({ t: S.t, type, pump: "plum" }, data));
  const onChange = (fn) => listeners.push(fn);
  function emit() { listeners.forEach((fn) => fn(S)); }
  function flash(text, kind = "info") { S.flash = { text, kind, until: Date.now() + 3500 }; }
  function go(id, ctx = {}) { S.screen = Object.assign({}, ctx, { id }); S.buffer = ""; emit(); }
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const line = (id) => S.channels[id];

  // ------------------------------------------------------------ units
  function parseUnit(label) {
    if (label === "mL/hr") return null;
    const p = label.split("/");
    return { unit: NAME_TO_UNIT[p[0]], perKg: p[1] === "kg", time: p[p.length - 1] === "min" ? "min" : "hr" };
  }
  function drugDoseLabel(drug) {
    if (!drug || !drug.dose) return "mL/hr";
    const d = drug.dose;
    return `${UNIT_TO_NAME[d.unit]}${d.perKg ? "/kg" : ""}/${d.time}`;
  }
  const famOf = (doseLabel) => FAMILY[doseLabel.split("/")[0]];

  // A program's dose math uses the units the nurse picked.
  const calcDrug = (p) => ({ dose: parseUnit(p.doseUnit) });
  const calcConc = (p) => ({ amt: p.concAmt, unit: NAME_TO_UNIT[p.concUnit], vol: p.concVol });
  const isDose = (p) => !!(p && p.therapy === "dose" && p.doseUnit !== "mL/hr");
  const perKg = (p) => isDose(p) && parseUnit(p.doseUnit).perKg;

  // This pump lists each drug name once; the dose units picked decide whether
  // it matches the library's plain or weight-based entry (for grading).
  function libId(p) {
    if (!p.drugId) return null;
    const ids = [p.drugId].concat(Object.keys(DRUGS).filter((id) => DRUGS[id].base === p.drugId));
    return ids.find((id) => drugDoseLabel(DRUGS[id]) === p.doseUnit) || p.drugId;
  }
  // Dose/concentration expressed in the drug library's own units (for grading).
  function libDose(p, rate) {
    const lib = p.drugId && DRUGS[libId(p)];
    if (!lib || !lib.dose || !isDose(p)) return null;
    return r3(rateToDose(lib, { amt: p.concAmt * UNIT_FACTORS[NAME_TO_UNIT[p.concUnit]], unit: "mg", vol: p.concVol }, rate, p.weight));
  }
  function libConcAmt(p) {
    const lib = p.drugId && DRUGS[libId(p)];
    if (!lib || !isDose(p) || !lib.concs[0].amt) return null;
    return r3((p.concAmt * UNIT_FACTORS[NAME_TO_UNIT[p.concUnit]]) / UNIT_FACTORS[lib.concs[0].unit]);
  }

  // ------------------------------------------------------------ drafts
  function newDraft(lineId, from) {
    const base = { line: lineId, drugId: null, therapy: null, doseUnit: "mL/hr", concUnit: null, concAmt: null, concVol: null, weight: null, dose: null, rate: null, vtbi: null, duration: null, field: "rate", edits: [] };
    if (from) {
      const p = from;
      Object.assign(base, { drugId: p.drugId, therapy: p.therapy, doseUnit: p.doseUnit, concUnit: p.concUnit, concAmt: p.concAmt, concVol: p.concVol, weight: p.weight, dose: p.dose, rate: p.rate, vtbi: r1(p.remaining), duration: p.rate ? Math.round((p.remaining / p.rate) * 60) : null, running: true });
      base.field = isDose(base) ? "dose" : "rate";
      base.orig = { dose: p.dose, rate: p.rate, vtbi: r1(p.remaining) };
    }
    return base;
  }

  function fieldsFor(d) {
    const f = [];
    if (d.line === "B") f.push("mode");
    if (isDose(d)) {
      if (!d.running) f.push("concAmt", "concVol");
      if (perKg(d) && !d.running) f.push("weight");
      f.push("dose", "vtbi", "duration", "rate");
    } else f.push("rate", "vtbi", "duration");
    return f;
  }

  const setupDone = (d) => !isDose(d) || (d.concAmt > 0 && d.concVol > 0 && (!perKg(d) || d.weight > 0));

  // Automatic calculation (manual section 6.8): two values set, the third follows.
  function recalc(d, f) {
    const known = (x) => d[x] != null && d[x] > 0;
    const doseToR = () => { if (isDose(d) && known("dose") && setupDone(d)) d.rate = r1(doseToRate(calcDrug(d), calcConc(d), d.dose, d.weight)); };
    const rToDose = () => { if (isDose(d) && known("rate") && setupDone(d)) d.dose = r3(rateToDose(calcDrug(d), calcConc(d), d.rate, d.weight)); };
    const durFrom = () => { if (known("vtbi") && known("rate")) d.duration = Math.max(1, Math.round((d.vtbi / d.rate) * 60)); };
    if (f === "dose") { doseToR(); durFrom(); }
    else if (f === "rate") { rToDose(); if (known("vtbi")) durFrom(); else if (known("duration")) d.vtbi = r1(d.rate * d.duration / 60); }
    else if (f === "vtbi") { if (known("rate")) durFrom(); else if (known("duration")) { d.rate = r1(d.vtbi / (d.duration / 60)); rToDose(); } }
    else if (f === "duration") { if (known("vtbi")) { d.rate = r1(d.vtbi / (d.duration / 60)); rToDose(); } else if (known("rate")) d.vtbi = r1(d.rate * d.duration / 60); }
    else if (["concAmt", "concVol", "weight"].includes(f)) doseToR();
  }

  // "30" = 0:30, "130" = 1:30
  function parseTime(buf) {
    const dg = buf.replace(/\D/g, "");
    if (!dg) return NaN;
    return dg.length <= 2 ? +dg : +dg.slice(0, -2) * 60 + +dg.slice(-2);
  }
  const fmtTime = (m) => (m == null || !m ? "00:00" : m > 99 * 60 + 59 ? "--:--" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`);

  function commitBuffer(d) {
    if (S.buffer === "") return true;
    const f = d.field;
    const v = f === "duration" ? parseTime(S.buffer) : parseFloat(S.buffer);
    S.buffer = "";
    if (isNaN(v) || v <= 0) { flash("Invalid entry", "warn"); return false; }
    if (f === "weight") S.weight = v;
    d[f] = v;
    if (!d.edits.includes(f)) d.edits.push(f);
    recalc(d, f);
    return true;
  }

  function moveField(dir) {
    const d = S.screen.draft;
    if (!commitBuffer(d)) { emit(); return; }
    const fs = fieldsFor(d);
    const i = fs.indexOf(d.field);
    const next = fs[Math.max(0, Math.min(fs.length - 1, i + dir))];
    // Concentration and weight must be entered before the other fields open.
    if (dir > 0 && ["concAmt", "concVol", "weight"].includes(d.field) && !(d[d.field] > 0)) { flash("Enter a value first", "warn"); emit(); return; }
    d.field = next;
    emit();
  }

  function validate(d) {
    if (isDose(d) && !setupDone(d)) return "Enter concentration and weight";
    if (!(d.rate > 0)) return "Enter a Rate";
    if (!(d.vtbi > 0)) return "Enter a VTBI";
    if (d.rate > 999) return "Rate out of range (0.1–999)";
    return null;
  }

  // ------------------------------------------------------------ running
  function toProgram(d) {
    return { drugId: d.drugId, drug: d.drugId ? DRUGS[d.drugId] : null, therapy: d.therapy, doseUnit: d.doseUnit, concUnit: d.concUnit, concAmt: d.concAmt, concVol: d.concVol, weight: d.weight, dose: d.dose, rate: d.rate, vtbi: d.vtbi, remaining: d.vtbi, overrides: [], mode: isDose(d) ? "dosecalc" : "rate" };
  }

  function startDraft(d) {
    const L = line(d.line), A = line("A");
    const prog = toProgram(d);
    const evt = { ch: d.line, drugId: libId(prog), mode: isDose(d) ? "guardrails" : "rate", therapy: prog.mode, dose: libDose(prog, d.rate), doseUnit: d.doseUnit, enteredDose: d.dose,
      concVol: isDose(d) ? d.concVol : null, concAmt: libConcAmt(prog), weight: perKg(d) ? d.weight : null, rate: d.rate, vtbi: d.vtbi, traced: true, overrides: 0 };
    if (d.line === "B" && L.mode === "Piggyback" && ["running", "delayed", "kvo"].includes(A.state) && A.primary) {
      L.primary = prog; L.state = "running"; L.alarm = null; A.state = "delayed";
      log("startSecondary", Object.assign(evt, { hung: true, clamp: true, piggyback: true }));
    } else {
      L.primary = prog; L.state = "running"; L.alarm = null;
      log("start", Object.assign(evt, { concurrent: d.line === "B" && L.mode === "Concurrent" }));
    }
    go("main");
  }

  function applyChange(d) {
    const L = line(d.line), p = L.primary;
    const changed = (k) => d.orig && Math.abs((d[k] || 0) - (d.orig[k] || 0)) > 1e-9;
    if (changed("dose") || changed("rate")) {
      log("titrate", { ch: d.line, drugId: p.drugId, fromDose: libDose(p, p.rate), toDose: libDose(Object.assign({}, p, { dose: d.dose }), d.rate), fromRate: p.rate, toRate: d.rate, state: L.state });
      Object.assign(p, { dose: d.dose, rate: d.rate });
    }
    if (changed("vtbi")) { Object.assign(p, { vtbi: d.vtbi, remaining: d.vtbi }); log("newVtbi", { ch: d.line, vtbi: d.vtbi, rate: p.rate }); }
    if (L.state === "kvo" || L.state === "stopped") { L.state = "running"; L.alarm = null; }
    go("main");
  }

  const ALARMS = {
    completeA: { msg: "Line A VTBI complete", level: "high" },
    completeB: { msg: "Line B VTBI complete", level: "high" },
  };
  function raise(id, type) {
    const L = line(id);
    L.alarm = Object.assign({ type }, ALARMS[type + id] || ALARMS[type]);
    S.silencedUntil = 0;
    log("alarm", { ch: id, alarm: "complete" });
  }

  function tick(dt) {
    if (!S.on || S.screen.id === "boot") return;
    S.t += dt;
    const dth = dt / 3600;
    LINES.forEach((id) => {
      const L = line(id), p = L.primary;
      if (!p) return;
      if (L.state === "kvo") { L.vi += Math.min(1, p.rate) * dth; return; }
      if (L.state !== "running") return;
      const v = Math.min(p.rate * dth, p.remaining);
      p.remaining = Math.max(0, p.remaining - v); L.vi += v;
      if (p.remaining <= 0.0001) {
        const A = line("A");
        if (id === "B" && A.state === "delayed") {
          // Piggyback done: Line A restarts on its own (no callback in practice).
          L.state = "idle"; L.primary = null; A.state = "running";
          log("secondaryComplete", { ch: "A", fromPrimary: 0 });
        } else { L.state = "kvo"; raise(id, "complete"); log("complete", { ch: id }); }
      }
    });
    emit();
  }

  function currentRate(L) {
    if (!L.primary) return 0;
    if (L.state === "kvo") return Math.min(1, L.primary.rate);
    return L.state === "running" ? L.primary.rate : 0;
  }

  // ------------------------------------------------------------ keys
  function power() {
    if (!S.on) {
      S.on = true; log("powerOn"); go("boot");
      bootTimer = setTimeout(() => {
        if (S.screen.id !== "boot") return;
        const has = LINES.some((id) => line(id).primary);
        go(has ? "clearSettings" : "main");
      }, BOOT_MS);
      return;
    }
    if (LINES.some((id) => ["running", "delayed"].includes(line(id).state))) { flash("Stop delivery then turn off", "warn"); emit(); return; }
    clearTimeout(bootTimer); S.on = false; log("powerOff"); go("off");
  }

  function key(k) {
    if (!S.on || S.screen.id === "boot") return;
    const sc = S.screen;
    if (k === "SILENCE") {
      S.silencedUntil = Date.now() + 120000; log("silence"); emit(); return;
    }
    if (k === "UP" || k === "DOWN") {
      const dir = k === "UP" ? -1 : 1;
      if (sc.list) { sc.cur = Math.max(0, Math.min(sc.list.length - 1, sc.cur + dir)); emit(); return; }
      if (sc.draft) return moveField(dir);
      return;
    }
    if (/^[0-9.]$/.test(k)) {
      const d = sc.draft;
      if (!d || !["program"].includes(sc.id) || d.field === "mode") return;
      if (k === "." && (S.buffer.includes(".") || d.field === "duration")) return;
      if (S.buffer.length >= 7) return;
      S.buffer += k; emit();
      return;
    }
    if (k === "CLEAR") {
      const d = sc.draft;
      if (sc.id === "program" && d && d.field !== "mode") { S.buffer = ""; if (d.field === "weight") S.weight = null; d[d.field] = null; emit(); }
      return;
    }
    if (k === "START") return start();
    if (k === "STOP") return stop();
  }

  function start() {
    const sc = S.screen;
    if (sc.id === "program") {
      const d = sc.draft;
      if (!commitBuffer(d)) { emit(); return; }
      if (d.running) return applyChange(d);
      const err = validate(d);
      if (err) { flash(err, "warn"); emit(); return; }
      if (d.line === "B" && line("B").mode === "Concurrent" && !line("A").primary) { /* allowed: B alone */ }
      if (isDose(d)) return go("confirm", { draft: d });
      return startDraft(d);
    }
    if (sc.id === "main") {
      const stopped = LINES.filter((id) => line(id).state === "stopped" && line(id).primary);
      if (!stopped.length) { flash("Select A or B to program", "warn"); emit(); return; }
      stopped.forEach((id) => { line(id).state = "running"; log("resume", { ch: id, fromAlarm: null }); });
      emit();
    }
  }

  function stop() {
    const sc = S.screen;
    const active = LINES.filter((id) => ["running", "delayed", "kvo"].includes(line(id).state));
    if (!active.length) return;
    if (sc.id === "program" && sc.draft && sc.draft.running) { stopLine(sc.draft.line); return; }
    if (active.length === 1) { stopLine(active[0]); return; }
    go("stopWhich");
  }
  function stopLine(id) {
    const L = line(id);
    if (id === "B" && line("A").state === "delayed") line("A").state = "stopped";
    L.state = "stopped"; L.alarm = null; log("pause", { ch: id }); go("main");
  }

  function softKey(side, i) {
    if (!S.on || !S.spec) return;
    const k = S.spec.soft[i];
    if (k && k.fn) k.fn();
  }

  // ------------------------------------------------------------ flow
  function openLine(id) {
    const L = line(id);
    log("select", { ch: id });
    if (L.primary && ["running", "delayed", "kvo", "stopped"].includes(L.state)) {
      if (L.state === "kvo") L.alarm = null;
      return go("program", { draft: newDraft(id, L.primary) });
    }
    go("program", { draft: newDraft(id) });
  }

  function drugListItems() {
    const names = Object.keys(DRUGS).filter((id) => !/fluid|blood|bolus/i.test(DRUGS[id].cls) && !DRUGS[id].base)
      .map((id) => ({ label: DRUGS[id].name, drugId: id }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return [{ label: "No Drug Selected", drugId: null }].concat(names);
  }
  function openDrugList(draft, next) {
    const list = drugListItems();
    const cur = Math.max(0, list.findIndex((x) => x.drugId === draft.drugId));
    go("drugList", { draft, next, list, cur });
  }
  function page(dir) { const sc = S.screen; sc.cur = Math.max(0, Math.min(sc.list.length - 1, sc.cur + dir * PAGE)); emit(); }

  function drugPicked() {
    const sc = S.screen, d = sc.draft, it = sc.list[sc.cur];
    d.drugId = it.drugId;
    if (it.drugId) log("drugPicked", { ch: d.line, drugId: it.drugId });
    if (sc.next === "therapy") return go("therapy", { draft: d, list: THERAPIES.map((t) => ({ label: t })), cur: 0 });
    go("options", { draft: d });
  }

  function therapyChosen() {
    const sc = S.screen, d = sc.draft;
    if (sc.cur !== 0) { flash("Only Dose Calculation is used in practice", "warn"); emit(); return; }
    const def = drugDoseLabel(d.drugId && DRUGS[d.drugId]);
    go("doseUnits", { draft: d, list: DOSE_UNITS.map((u) => ({ label: u })), cur: Math.max(0, DOSE_UNITS.indexOf(def)) });
  }

  function doseUnitChosen() {
    const sc = S.screen, d = sc.draft;
    d.doseUnit = sc.list[sc.cur].label;
    d.therapy = "dose";
    if (d.doseUnit === "mL/hr") { d.therapy = null; d.field = "rate"; return go("program", { draft: d }); }
    const opts = CONC_UNITS[famOf(d.doseUnit)];
    const lib = d.drugId && DRUGS[d.drugId];
    const def = lib && lib.concs[0].amt ? UNIT_TO_NAME[lib.concs[0].unit] : opts[0];
    go("concUnits", { draft: d, list: opts.map((u) => ({ label: u })), cur: Math.max(0, opts.indexOf(def)) });
  }

  function concUnitChosen() {
    const sc = S.screen, d = sc.draft;
    d.concUnit = sc.list[sc.cur].label;
    Object.assign(d, { concAmt: null, concVol: null, dose: null, rate: null, duration: null, weight: perKg(d) ? S.weight : null });
    d.field = "concAmt";
    log("drugSelected", { ch: d.line, drugId: d.drugId, conc: "entered by nurse", secondary: false });
    go("program", { draft: d });
  }

  // ------------------------------------------------------------ screens
  const K = (label, fn) => ({ label, fn });

  function statusWord(L) {
    if (L.alarm) return "ALARM";
    return { running: "PUMPING", delayed: "DELAYED", kvo: "KVO", stopped: "STOPPED" }[L.state] || "STOPPED";
  }

  function spec() {
    const sc = S.screen;
    const base = { hdr: null, title: "", drug: "", rows: null, body: "", msg: "", soft: [null, null, null, null], alert: null };
    switch (sc.id) {
      case "off": return Object.assign(base, { off: true });
      case "boot": return Object.assign(base, { boot: true });
      case "clearSettings":
        return Object.assign(base, { title: "SETUP", body: `<div class="pl-center"><b>Clear Settings?</b><br>Yes clears ALL settings</div>`, msg: "",
          soft: [K("Yes", () => { LINES.forEach((id) => { const b = line(id).bedside; S.channels[id] = Object.assign(newLine(id), { bedside: b }); }); S.weight = null; log("newPatient", { yes: true }); go("main"); }),
            K("No", () => { log("newPatient", { yes: false }); go("main"); }), null, null] });
      case "main": return mainSpec(base);
      case "stopWhich":
        return Object.assign(base, { title: "STOP", body: `<div class="pl-center">Stop which line?</div>`,
          soft: [K("Stop A", () => stopLine("A")), K("Stop B", () => stopLine("B")), K("Stop All", () => { LINES.forEach((id) => { if (["running", "delayed", "kvo"].includes(line(id).state)) { line(id).state = "stopped"; log("pause", { ch: id }); } }); go("main"); }), K("Cancel/ Back", () => go("main"))] });
      case "program": return programSpec(base, sc.draft);
      case "options": {
        const d = sc.draft;
        return Object.assign(base, { title: "Program Options", line: d.line, drug: d.drugId ? DRUGS[d.drugId].name : "",
          rows: [{ label: "Delay Start for", value: "00:00", unit: "hr:min" }, { label: "Callback", value: "No", unit: "" }],
          msg: "Enter Value using keypad",
          soft: [K("Drug List", () => openDrugList(d, "options")), K("Standby", () => { flash("Standby is not used in practice"); emit(); }), K("Enter", () => go("program", { draft: d })), K("Cancel/ Back", () => go("program", { draft: d }))] });
      }
      case "drugList":
        return Object.assign(base, { title: "Program Drug List", line: sc.draft.line, body: listHTML(sc), msg: "Select, then Enter",
          soft: [K("Page Up", () => page(-1)), K("Page Down", () => page(1)), K("Enter", drugPicked), K("Cancel/ Back", () => go(sc.next === "therapy" ? "program" : "options", { draft: sc.draft }))] });
      case "therapy":
        return Object.assign(base, { title: "PROGRAM", line: sc.draft.line, drug: sc.draft.drugId ? DRUGS[sc.draft.drugId].name : "No Drug Selected", body: listHTML(sc), msg: "Select, then Choose",
          soft: [K("Choose", therapyChosen), null, null, K("Back", () => openDrugList(sc.draft, "therapy"))] });
      case "doseUnits":
        return Object.assign(base, { title: "Program Dose Calc", line: sc.draft.line, drug: sc.draft.drugId ? DRUGS[sc.draft.drugId].name : "", body: listHTML(sc, true), msg: "Select, then Choose",
          soft: [K("Choose", doseUnitChosen), null, null, K("Back", () => go("therapy", { draft: sc.draft, list: THERAPIES.map((t) => ({ label: t })), cur: 0 }))] });
      case "concUnits":
        return Object.assign(base, { title: "Program Dose Calc", line: sc.draft.line, drug: sc.draft.drugId ? DRUGS[sc.draft.drugId].name : "", body: `<div class="pl-sub">Drug Conc in Container</div>${listHTML(sc)}`, msg: "Select, then Choose",
          soft: [K("Choose", concUnitChosen), null, null, K("Back", () => go("doseUnits", { draft: sc.draft, list: DOSE_UNITS.map((u) => ({ label: u })), cur: Math.max(0, DOSE_UNITS.indexOf(sc.draft.doseUnit)) }))] });
      case "confirm": {
        const d = sc.draft;
        return Object.assign(base, { title: "Program Dose Calc", line: d.line, body: `<div class="pl-sub">Delivery will be:</div>`,
          rows: [{ label: "Dose", value: fmtNum(d.dose, 3), unit: d.doseUnit }, { label: "Drug", value: d.drugId ? DRUGS[d.drugId].name : "No Drug Selected", unit: "" },
            { label: "Conc", value: `${fmtNum(d.concAmt, 3)} ${d.concUnit}`, unit: `${fmtNum(d.concVol, 1)} mL` }].concat(perKg(d) ? [{ label: "Weight", value: fmtNum(d.weight, 1), unit: "kg" }] : []),
          msg: "Confirm Program?",
          soft: [K("Yes", () => startDraft(d)), K("No", () => go("program", { draft: d })), null, null] });
      }
      case "volInf":
        return Object.assign(base, { title: "OPTIONS", body: `<div class="pl-sub">Volumes Infused</div>`,
          rows: [{ label: "Line A", value: fmtNum(line("A").vi, 1), unit: "mL" }, { label: "Line B", value: fmtNum(line("B").vi, 1), unit: "mL" }, { label: "Total", value: fmtNum(line("A").vi + line("B").vi, 1), unit: "mL" }],
          soft: [K("Clear A", () => { line("A").vi = 0; emit(); }), K("Clear B", () => { line("B").vi = 0; emit(); }), K("Clear Total", () => { line("A").vi = 0; line("B").vi = 0; log("clearVolume"); emit(); }), K("Cancel/ Back", () => go("main"))] });
    }
    return base;
  }

  function mainSpec(base) {
    const A = line("A"), B = line("B");
    const running = LINES.some((id) => ["running", "delayed", "kvo"].includes(line(id).state));
    const col = (L) => {
      const p = L.primary;
      return { name: p ? (p.drugId ? DRUGS[p.drugId].name : "") : "", therapy: p && p.mode === "dosecalc" ? "Dose Calculation" : "",
        dose: p && p.mode === "dosecalc" ? `${fmtNum(p.dose, 3)}` : "", doseUnit: p && p.mode === "dosecalc" ? p.doseUnit : "",
        rate: fmtNum(p ? currentRate(L) || p.rate : 0, 1), vi: fmtNum(L.vi, 1), status: statusWord(L), alarm: !!L.alarm };
    };
    return Object.assign(base, { main: { A: col(A), B: col(B) },
      msg: A.alarm ? A.alarm.msg : B.alarm ? B.alarm.msg : "",
      alert: A.alarm || B.alarm ? "hard" : null,
      soft: [running ? null : K("Back Prime", () => { flash("Back prime is not needed in practice"); emit(); }), K("A", () => openLine("A")), K("B", () => openLine("B")), K("Options/ Vol Inf", () => go("volInf"))] });
  }

  function listHTML(sc, twoCol) {
    const start = Math.floor(sc.cur / PAGE) * PAGE;
    const items = sc.list.slice(start, start + PAGE);
    return `<ul class="pl-list${twoCol ? " two" : ""}">${items.map((it, i) => `<li class="${start + i === sc.cur ? "on" : ""}">${it.label}</li>`).join("")}</ul>`;
  }

  function programSpec(base, d) {
    const L = line(d.line);
    const val = (f, v, digits) => (d.field === f && S.buffer !== "" ? (f === "duration" ? fmtTime(parseTime(S.buffer)) : S.buffer) : f === "duration" ? fmtTime(v) : fmtNum(v || 0, digits));
    const row = (f, label, unit, digits) => ({ label, value: val(f, d[f], digits), unit, on: d.field === f });
    const rows = [];
    if (d.line === "B") rows.push({ label: "Mode", value: L.mode, unit: "", on: d.field === "mode" });
    if (isDose(d)) {
      rows.push({ label: "Conc", value: val("concAmt", d.concAmt, 3), unit: d.concUnit, on: d.field === "concAmt", lock: d.running },
        { label: "", value: val("concVol", d.concVol, 1), unit: "mL", on: d.field === "concVol", lock: d.running });
      if (perKg(d)) rows.push({ label: "Weight", value: val("weight", d.weight, 1), unit: "kg", on: d.field === "weight", lock: d.running });
      rows.push(row("dose", "Dose", d.doseUnit, 3), row("vtbi", "VTBI", "mL", 1), row("duration", "Duration", "hr:min"), row("rate", "Rate", "mL/hr", 1));
    } else rows.push(row("rate", "Rate", "mL/hr", 1), row("vtbi", "VTBI", "mL", 1), row("duration", "Duration", "hr:min"));
    const msg = d.field === "mode" ? "Change using Change Mode" : d.field === "duration" ? "Enter hr:min (130 = 1 hr 30 min)" : "Enter Value using keypad";
    const soft = [K("Program Options", () => go("options", { draft: d }))];
    if (d.line === "B" && !d.running) soft.push(K("Change Mode", () => { L.mode = L.mode === "Piggyback" ? "Concurrent" : "Piggyback"; emit(); }));
    else soft.push(null);
    soft.push(d.running ? null : K("Therapy", () => openDrugList(d, "therapy")));
    soft.push(K("Cancel/ Back", () => { log("cancelProgram", { ch: d.line }); go("main"); }));
    return Object.assign(base, { title: isDose(d) ? "Program Dose Calc" : "PROGRAM", line: d.line, drug: d.drugId ? DRUGS[d.drugId].name : "", rows, msg, soft });
  }

  function render() {
    if (S.flash && Date.now() > S.flash.until) S.flash = null;
    S.spec = spec();
    return S.spec;
  }

  // A line is being programmed but not started.
  function pending() {
    const sc = S.screen;
    if (["drugList", "therapy", "doseUnits", "concUnits", "confirm", "options"].includes(sc.id)) return true;
    if (sc.id !== "program") return false;
    const d = sc.draft;
    if (!d.running) return true;
    return S.buffer !== "" || ["dose", "rate", "vtbi"].some((k) => Math.abs((d[k] || 0) - (d.orig[k] || 0)) > 1e-9);
  }

  function bedside(chId, action) { log("bedside", { ch: chId, action }); emit(); }

  const READY = { primed: true, loaded: true, traced: true, clampOpen: true };

  // Mid-shift setup used by practice mode (same config shape as the other pumps).
  function preset(cfg) {
    reset();
    S.on = true; S.profile = cfg.profile; S.weight = cfg.weight || null; S.patientId = cfg.patientId || null;
    LINES.forEach((id) => Object.assign(line(id).bedside, READY, { primaryBag: 1000 }));
    const a = (cfg.channels || []).find((x) => x.ch === "A");
    if (a && a.drugId) {
      const drug = profileDrug(cfg.profile, a.drugId) || DRUGS[a.drugId], conc = drug.concs[a.concIdx || 0];
      const prog = { drugId: drug.dose ? drug.base || a.drugId : null, drug, overrides: [], vtbi: a.vtbi, remaining: a.remaining != null ? a.remaining : a.vtbi };
      if (drug.dose && a.dose != null) {
        Object.assign(prog, { therapy: "dose", mode: "dosecalc", doseUnit: drugDoseLabel(drug), concUnit: UNIT_TO_NAME[conc.unit], concAmt: conc.amt, concVol: conc.vol, weight: drug.dose.perKg ? S.weight : null, dose: a.dose });
        prog.rate = r1(doseToRate(drug, conc, a.dose, S.weight));
      } else Object.assign(prog, { therapy: null, mode: "rate", doseUnit: "mL/hr", rate: a.rate });
      line("A").primary = prog; line("A").state = "running";
    }
    S.screen = { id: "main" };
    emit();
  }

  reset();
  return {
    get state() { return S; }, reset, preset, tick, render, onChange, emit, log, flash,
    power, key, softKey, bedside, pending, currentRate, DOSE_UNITS,
    drugLabel: (p) => (p && p.drugId ? DRUGS[p.drugId].name : ""), hasDose: isDose, doseUnit: (p) => (p ? p.doseUnit : "mL/hr"),
  };
})();
