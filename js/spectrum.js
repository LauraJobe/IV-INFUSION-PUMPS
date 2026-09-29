/*
 * Single-channel large-volume pump simulator, modeled on the programming
 * workflow in the Baxter Spectrum IQ operator manual (color screen, four
 * soft keys under the screen, ON/OFF - SCAN - OK - RUN/STOP hard keys and a
 * keypad that also types letters). For education only: not the
 * manufacturer's software.
 *
 * It exposes the same state shape and log events as the modular pump
 * (pump.js) so practice mode, the check-off and grading work unchanged.
 */

const Spectrum = (() => {
  const LETTERS = { 1: "ABC", 2: "DEF", 3: "GHI", 4: "JKL", 5: "MNO", 6: "PQR", 7: "STU", 8: "VWX", 9: "YZ" };
  const MULTITAP_MS = 1100;
  const BOOT_MS = 3200;
  let S;
  const listeners = [];
  let bootTimer = null, tapTimer = null, bagTimer = null;

  function newBedside() {
    return { primed: false, loaded: false, traced: false, clampOpen: false, occluded: false, air: false, primaryBag: 0, primaryBagName: "", secondaryHung: false, secondaryClampOpen: false, secondaryBag: 0, secondaryBagName: "" };
  }
  function newChannel(id) {
    return { id, state: "idle", primary: null, secondary: null, onSecondary: false, vi: 0, alarm: null, pausedAt: null, bedside: newBedside() };
  }

  function reset() {
    [bootTimer, tapTimer, bagTimer].forEach(clearTimeout);
    S = {
      on: false, t: 0, profile: null, weight: null, patientId: null,
      channels: { A: newChannel("A"), B: newChannel("B") },
      screen: { id: "off" }, spec: null, buffer: "", letters: "", tap: null,
      silencedUntil: 0, flash: null, log: [],
    };
    emit();
  }

  const log = (type, data = {}) => S.log.push(Object.assign({ t: S.t, type }, data));
  const onChange = (fn) => listeners.push(fn);
  function emit() { listeners.forEach((fn) => fn(S)); }
  function flash(text, kind = "info") { S.flash = { text, kind, until: Date.now() + 3500 }; }
  function go(id, ctx = {}) { S.screen = Object.assign({}, ctx, { id }); S.buffer = ""; emit(); }
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const ch = () => S.channels.A;

  // ------------------------------------------------------------ library
  const isIVPB = (d) => /IVPB/i.test(d.cls);
  const hasDose = (p) => !!(p && p.mode === "guardrails" && p.drug && p.drug.dose);
  const doseUnit = (p) => (p && p.drug && p.drug.dose ? doseUnitLabel(p.drug).replace("/hr", "/hr") : "mL/hr");
  const drugLabel = (p) => (!p ? "" : p.mode === "basic" ? "Basic Infusion" : p.drug.name);
  const matchName = (name, prefix) => name.replace(/[^A-Za-z]/g, "").toUpperCase().startsWith(prefix);

  // ------------------------------------------------------------ drafts
  function newDraft(opts) {
    return Object.assign({ mode: "guardrails", drugId: null, drug: null, conc: null, dose: null, rate: null, vtbi: null, time: null, field: null, overrides: [], secondary: false }, opts);
  }

  function fieldsFor(d) {
    const f = [];
    if (hasDose(d) && d.drug.dose.perKg) f.push("weight");
    if (hasDose(d)) f.push("dose", "vtbi");
    else f.push("rate", "vtbi", "time");
    return f;
  }

  function recalc(d, from) {
    const w = S.weight;
    const noW = hasDose(d) && d.drug.dose.perKg && !w;
    if (hasDose(d) && !noW) {
      if ((from === "dose" || from === "weight") && d.dose != null) d.rate = r1(doseToRate(d.drug, d.conc, d.dose, w));
      if (from === "rate" && d.rate != null) d.dose = r2(rateToDose(d.drug, d.conc, d.rate, w));
    }
    if (from === "time" && d.vtbi && d.time) {
      d.rate = r1(d.vtbi / (d.time / 60));
      if (hasDose(d) && !noW) d.dose = r2(rateToDose(d.drug, d.conc, d.rate, w));
    } else if (d.rate && d.vtbi) d.time = Math.round((d.vtbi / d.rate) * 60);
  }

  // "30" = 0:30, "130" = 1:30 (typed like the pump's hr:min field)
  function parseTime(buf) {
    const dg = buf.replace(/\D/g, "");
    if (!dg) return NaN;
    return dg.length <= 2 ? +dg : +dg.slice(0, -2) * 60 + +dg.slice(-2);
  }
  const fmtTime = (m) => (m == null ? "00:00" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`);

  function limitCheck(d) {
    if (d.mode !== "guardrails") return null;
    const l = d.drug.limits, val = hasDose(d) ? d.dose : d.rate, unit = hasDose(d) ? doseUnitLabel(d.drug) : "mL/hr";
    if (val == null) return null;
    if (l.hardMax != null && val > l.hardMax + 1e-9) return { kind: "hard", dir: "max", val, limit: l.hardMax, unit };
    if (l.hardMin != null && val < l.hardMin - 1e-9) return { kind: "hard", dir: "min", val, limit: l.hardMin, unit };
    const done = (dir) => d.overrides.some((o) => o.dir === dir && Math.abs(o.val - val) < 1e-9);
    if (l.softMax != null && val > l.softMax + 1e-9 && !done("max")) return { kind: "soft", dir: "max", val, limit: l.softMax, unit };
    if (l.softMin != null && val < l.softMin - 1e-9 && !done("min")) return { kind: "soft", dir: "min", val, limit: l.softMin, unit };
    return null;
  }

  // Commit the typed value into the highlighted field. Returns false if blocked by a limit screen.
  function commit(d, back) {
    const f = d.field;
    if (S.buffer !== "") {
      const v = f === "time" ? parseTime(S.buffer) : parseFloat(S.buffer);
      S.buffer = "";
      if (isNaN(v) || v <= 0) { flash("Invalid entry", "warn"); return false; }
      if (f === "weight") { S.weight = v; log("weight", { kg: v }); }
      else d[f] = v;
      recalc(d, f);
    }
    if (["dose", "rate", "time", "weight"].includes(f)) {
      const lim = limitCheck(d);
      if (lim) {
        log(lim.kind === "hard" ? "hardLimit" : "softLimit", { ch: "A", drugId: d.drugId, val: lim.val, limit: lim.limit, dir: lim.dir });
        go("limit", { draft: d, lim, back });
        return false;
      }
    }
    return true;
  }

  function nextField(d) {
    const fs = fieldsFor(d);
    const i = fs.indexOf(d.field);
    const rest = fs.slice(i + 1);
    const need = rest.find((f) => (f === "weight" ? !S.weight : d[f] == null));
    d.field = need || (rest.length ? rest[0] : "total");
    if (d.field === "time" && d.rate) d.field = "total";
  }

  function okOnSetup() {
    const d = S.screen.draft;
    if (d.field === "total") { flash("Press RUN/STOP to start"); emit(); return; }
    const wasVtbi = d.field === "vtbi";
    if (!commit(d, "setup")) { emit(); return; }
    if (wasVtbi && d.secondary && !S.screen.vtbiOk) { go("setup", { draft: d, vtbiPopup: true }); return; }
    nextField(d);
    go("setup", { draft: d });
  }

  function validate(d) {
    if (hasDose(d) && d.drug.dose.perKg && !S.weight) return "Enter patient weight";
    if (hasDose(d) && !d.dose) return "Enter the dose";
    if (!d.rate) return "Enter the rate or time";
    if (!d.vtbi) return "Enter the VTBI";
    if (d.rate > 999) return "Rate exceeds 999 mL/hr";
    return null;
  }

  // ------------------------------------------------------------ running
  function startDraft(d) {
    const c = ch(), b = c.bedside;
    const prog = { mode: d.mode, drugId: d.drugId, drug: d.drug, conc: d.conc, dose: d.dose, rate: d.rate, vtbi: d.vtbi, duration: d.time, remaining: d.vtbi, overrides: d.overrides.slice(), callback: false, weight: S.weight };
    if (d.secondary) {
      c.secondary = prog; c.onSecondary = true;
      log("startSecondary", { ch: "A", drugId: d.drugId, mode: d.mode, rate: d.rate, vtbi: d.vtbi, dose: d.dose, concVol: d.conc && d.conc.vol, overrides: d.overrides.length, traced: b.traced, hung: b.secondaryHung, clamp: b.secondaryClampOpen });
    } else {
      c.primary = prog;
      log("start", { ch: "A", drugId: d.drugId, mode: d.mode, concVol: d.conc && d.conc.vol, concAmt: d.conc && d.conc.amt, dose: d.dose, rate: d.rate, vtbi: d.vtbi, traced: b.traced, weight: S.weight, profile: S.profile, overrides: d.overrides.length });
    }
    if (d.mode === "basic") log("basicInfusion", { ch: "A" });
    run();
    go("bagInfusing", { secondary: d.secondary });
    clearTimeout(bagTimer);
    bagTimer = setTimeout(() => { if (S.screen.id === "bagInfusing") go("run"); }, 1300);
  }

  function run() {
    const c = ch();
    c.alarm = null; c.state = "running";
    if (!c.bedside.primed) raise("air");
  }

  const ALARMS = {
    air: { msg: "AIR IN LINE", level: "high" },
    patientOcc: { msg: "DOWNSTREAM OCCLUSION", level: "high" },
    fluidOcc: { msg: "UPSTREAM OCCLUSION", level: "high" },
    complete: { msg: "INFUSION COMPLETE - KVO", level: "high" },
    secComplete: { msg: "SECONDARY COMPLETE", level: "low" },
  };
  function raise(type) {
    const c = ch();
    c.alarm = Object.assign({ type }, ALARMS[type]);
    if (!["secComplete", "complete"].includes(type)) c.state = "alarm";
    S.silencedUntil = 0;
    log("alarm", { ch: "A", alarm: type });
  }

  function tick(dt) {
    if (!S.on || S.screen.id === "boot") return;
    S.t += dt;
    const c = ch(), b = c.bedside, dth = dt / 3600;
    if (c.state === "running" || c.state === "kvo") {
      if (!b.clampOpen) raise("fluidOcc");
      else if (b.occluded) raise("patientOcc");
      else if (b.air) raise("air");
      else if (c.onSecondary && c.secondary) {
        const s = c.secondary, v = Math.min(s.rate * dth, s.remaining);
        if (b.secondaryHung && b.secondaryClampOpen && b.secondaryBag > 0) b.secondaryBag -= v;
        else { b.primaryBag -= v; s.fromPrimary = (s.fromPrimary || 0) + v; }
        s.remaining -= v; c.vi += v;
        if (s.remaining <= 0.0001) { c.onSecondary = false; c.secondary = null; log("secondaryComplete", { ch: "A", fromPrimary: s.fromPrimary || 0 }); raise("secComplete"); }
      } else if (c.primary) {
        const p = c.primary;
        if (c.state === "kvo") { const v = Math.min(1, p.rate) * dth; b.primaryBag -= v; c.vi += v; }
        else {
          const v = Math.min(p.rate * dth, p.remaining);
          p.remaining = Math.max(0, p.remaining - v); b.primaryBag -= v; c.vi += v;
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
    if (["running", "kvo"].includes(ch().state)) { flash("Stop the infusion before powering off", "warn"); emit(); return; }
    clearTimeout(bootTimer); S.on = false; log("powerOff"); go("off");
  }

  function commitLetter() {
    if (!S.tap) return;
    S.letters += S.tap.ch; S.tap = null; clearTimeout(tapTimer);
    if (S.letters.length >= 2) showDrugList();
    else emit();
  }

  function key(k) {
    if (!S.on || S.screen.id === "boot") return;
    const sc = S.screen;
    if (k === "SILENCE") { S.silencedUntil = Date.now() + 120000; log("silence"); if (ch().alarm && ch().alarm.level === "low") ch().alarm = null; emit(); return; }
    if (sc.id === "hardPop") { go(sc.back.id, sc.back); return; }
    if (/^[0-9.]$/.test(k)) {
      if (sc.id === "drugSearch") {
        const set = LETTERS[k];
        if (!set) return;
        if (S.tap && S.tap.key === k) { S.tap.i = (S.tap.i + 1) % set.length; S.tap.ch = set[S.tap.i]; }
        else { commitLetter(); if (S.screen.id !== "drugSearch") return; S.tap = { key: k, i: 0, ch: set[0] }; }
        clearTimeout(tapTimer);
        tapTimer = setTimeout(commitLetter, MULTITAP_MS);
        emit();
        return;
      }
      const d = sc.draft;
      const editing = (sc.id === "setup" || sc.id === "change") && d && d.field && d.field !== "total";
      if (!editing) return;
      if (k === "." && (S.buffer.includes(".") || d.field === "time")) return;
      if (S.buffer.length >= 7) return;
      S.buffer += k; emit();
      return;
    }
    if (k === "OK") {
      if (sc.id === "drugSearch") { commitLetter(); if (S.screen.id === "drugSearch" && S.letters.length) showDrugList(); return; }
      if (sc.list) return pickFromList();
      if (sc.id === "setup") { if (sc.vtbiPopup) { go("setup", { draft: sc.draft, vtbiOk: true }); nextField(sc.draft); go("setup", { draft: sc.draft, vtbiOk: true }); return; } return okOnSetup(); }
      if (sc.id === "change") {
        const d = sc.draft;
        if (!commit(d, "change")) { emit(); return; }
        go("change", Object.assign({}, sc, { ready: true }));
      }
      return;
    }
    if (k === "RUNSTOP") return runStop();
    if (k === "SCAN") { flash("Barcode scanning is not used in practice"); emit(); }
  }

  function runStop() {
    const sc = S.screen, c = ch();
    if (sc.id === "setup") {
      const d = sc.draft;
      if (S.buffer !== "" && !commit(d, "setup")) { emit(); return; }
      const err = validate(d);
      if (err) { flash(err, "warn"); emit(); return; }
      const lim = limitCheck(d);
      if (lim) { log(lim.kind === "hard" ? "hardLimit" : "softLimit", { ch: "A", drugId: d.drugId, val: lim.val, limit: lim.limit, dir: lim.dir }); go("limit", { draft: d, lim, back: "setup" }); return; }
      if (!c.bedside.loaded) { flash("Load the IV set and close the door", "warn"); emit(); return; }
      go("checkFlow", { draft: d });
      return;
    }
    if (sc.id === "change" && sc.ready) {
      const d = sc.draft, p = c.primary;
      if (sc.what === "vtbi") { Object.assign(p, { vtbi: d.vtbi, remaining: d.vtbi }); log("newVtbi", { ch: "A", vtbi: d.vtbi, rate: p.rate }); if (c.state === "kvo") c.alarm = null; run(); }
      else {
        log("titrate", { ch: "A", drugId: p.drugId, fromDose: p.dose, toDose: d.dose, fromRate: p.rate, toRate: d.rate, state: c.state });
        Object.assign(p, { dose: d.dose, rate: d.rate, overrides: p.overrides.concat(d.overrides) });
      }
      go("run");
      return;
    }
    if (sc.id === "primaryReview" || sc.id === "stopped") {
      if (!c.primary) return;
      log("resume", { ch: "A", fromAlarm: c.alarm ? c.alarm.type : null });
      run(); go("run");
      return;
    }
    if (["running", "kvo", "alarm"].includes(c.state) && c.primary) {
      if (c.state === "alarm") { log("resume", { ch: "A", fromAlarm: c.alarm.type }); run(); go("run"); return; }
      c.state = "stopped"; log("pause", { ch: "A" }); go("stopped");
    }
  }

  function softKey(side, i) {
    if (!S.on || !S.spec) return;
    const k = S.spec.soft[i];
    if (k && k.fn) k.fn();
  }

  // ------------------------------------------------------------ flow
  function showDrugList() {
    const list = profileDrugList(S.profile).filter((d) => matchName(d.name, S.letters));
    if (!list.length) { flash(`No drugs start with "${S.letters}"`, "warn"); S.letters = ""; emit(); return; }
    go("drugList", { list: list.map((d) => ({ label: d.name, drug: d })), cur: 0, secondary: S.screen.secondary });
  }

  function pickFromList() {
    const sc = S.screen, item = sc.list[sc.cur];
    if (sc.id === "careArea") { S.profile = item.pid; log("profile", { profile: item.pid }); return toSearch(false); }
    if (sc.id === "drugList") {
      const d = item.drug;
      log("drugPicked", { ch: "A", drugId: d.id });
      if (d.concs.length > 1) return go("concList", { list: d.concs.map((c) => ({ label: concLabel(d, c), conc: c })), cur: 0, drug: d, secondary: sc.secondary });
      return go("confirm", { drug: d, conc: d.concs[0], secondary: sc.secondary });
    }
    if (sc.id === "concList") return go("confirm", { drug: sc.drug, conc: item.conc, secondary: sc.secondary });
    if (sc.id === "bag") {
      if (item.sec && !ch().primary) { flash("Program and start the primary infusion first", "warn"); emit(); return; }
      return toSetup(sc.drug, sc.conc, item.sec);
    }
  }

  function toSearch(secondary) { S.letters = ""; S.tap = null; go("drugSearch", { secondary }); }

  function afterConfirm(sc) {
    log("drugSelected", { ch: "A", drugId: sc.drug.id, conc: concLabel(sc.drug, sc.conc), secondary: !!sc.secondary });
    if (sc.drug.highAlert) return go("advisory", sc);
    afterAdvisory(sc);
  }
  function afterAdvisory(sc) {
    if (isIVPB(sc.drug) && !sc.secondary) return go("bag", { drug: sc.drug, conc: sc.conc, list: [{ label: "Primary Bag", sec: false }, { label: "Secondary Bag", sec: true }], cur: 0 });
    toSetup(sc.drug, sc.conc, sc.secondary);
  }
  function toSetup(drug, conc, secondary) {
    const d = newDraft({ drugId: drug.id, drug, conc, secondary: !!secondary });
    // IVPB: VTBI pre-fills with the bag volume; confirm it, then enter the time.
    if (!drug.dose && conc.vol && isIVPB(drug)) { d.vtbi = conc.vol; d.field = "vtbi"; }
    else d.field = fieldsFor(d)[0];
    if (d.field === "weight" && S.weight) d.field = "dose";
    go("setup", { draft: d });
  }

  function basic(secondary) {
    log("basicSelected", { ch: "A", secondary: !!secondary });
    const d = newDraft({ mode: "basic", secondary: !!secondary, field: "rate" });
    go("setup", { draft: d });
  }

  function openChange(what) {
    const p = ch().primary;
    const d = newDraft({ mode: p.mode, drugId: p.drugId, drug: p.drug, conc: p.conc, dose: p.dose, rate: p.rate, vtbi: r1(p.remaining), field: what });
    go("change", { draft: d, what, ready: false });
  }

  // ------------------------------------------------------------ screens
  const K = (label, fn) => ({ label, fn });
  const move = (dir) => () => { const sc = S.screen; sc.cur = Math.max(0, Math.min(sc.list.length - 1, sc.cur + dir)); emit(); };

  function spec() {
    const sc = S.screen, c = ch();
    const area = S.profile ? PROFILES[S.profile].name.replace("Adult ", "") : "";
    const base = { title: area, drug: "", sub: "", body: "", soft: [null, null, null, null], alarm: null, big: false };
    const setupDrug = (d) => ({ drug: drugLabel(d), sub: d.conc && d.conc.amt ? concLabel(d.drug, d.conc) : "" });
    switch (sc.id) {
      case "off": return Object.assign(base, { off: true });
      case "boot": return Object.assign(base, { boot: true });
      case "newPatient":
        return Object.assign(base, { title: "", body: `<div class="sq-big">New<br>Patient?</div><p>Is this a new patient?</p><p>Press ‘yes’ to clear current program.</p>`,
          soft: [K("yes", () => { S.weight = null; S.profile = null; S.channels.A = Object.assign(newChannel("A"), { bedside: ch().bedside }); log("newPatient", { yes: true }); go("careArea", { list: Object.keys(PROFILES).map((pid) => ({ label: PROFILES[pid].name, pid })), cur: 0 }); }),
            K("no", () => { log("newPatient", { yes: false }); if (S.profile) toSearch(false); else go("careArea", { list: Object.keys(PROFILES).map((pid) => ({ label: PROFILES[pid].name, pid })), cur: 0 }); }), null, null] });
      case "careArea":
        return Object.assign(base, { title: sc.list[sc.cur].label.replace("Adult ", ""), body: `<p class="sq-prompt">Select your care area and press OK.</p>${listHTML(sc)}`, soft: [K("▲", move(-1)), K("▼", move(1)), null, null] });
      case "drugSearch": {
        const shown = S.letters + (S.tap ? `<u>${S.tap.ch}</u>` : "");
        return Object.assign(base, { body: `<p class="sq-prompt">Type the first two letters of the drug name.</p><div class="sq-field"><span>Drug Name:</span><span class="sq-box">${shown || "&nbsp;"}<i class="cursor"></i></span></div><p class="sq-hint">Keys: 1 ABC · 2 DEF · 3 GHI · 4 JKL · 5 MNO · 6 PQR · 7 STU · 8 VWX · 9 YZ</p>${sc.secondary ? `<div class="sq-2">2</div>` : ""}`,
          soft: [K("back", () => { if (S.letters || S.tap) { S.letters = ""; S.tap = null; emit(); } else if (sc.secondary) go("primaryReview"); else go("careArea", { list: Object.keys(PROFILES).map((pid) => ({ label: PROFILES[pid].name, pid })), cur: Object.keys(PROFILES).indexOf(S.profile) }); }), null, null, K("not in library", () => basic(sc.secondary))] });
      }
      case "drugList":
        return Object.assign(base, { body: `<p class="sq-prompt">Select the desired drug and press OK.</p>${listHTML(sc)}`, soft: [K("back", () => toSearch(sc.secondary)), K("▲", move(-1)), K("▼", move(1)), null] });
      case "concList":
        return Object.assign(base, { drug: sc.drug.name, body: `<p class="sq-prompt">Select the concentration and press OK.</p>${listHTML(sc)}`, soft: [K("back", () => toSearch(sc.secondary)), K("▲", move(-1)), K("▼", move(1)), null] });
      case "confirm":
        return Object.assign(base, { drug: sc.drug.name, body: `<div class="sq-band">CONFIRM</div><div class="sq-center"><b>${sc.drug.name}</b><br>${concLabel(sc.drug, sc.conc)}</div><div class="sq-center sq-q">Correct?</div>`,
          soft: [K("yes", () => afterConfirm(sc)), K("no", () => toSearch(sc.secondary)), null, null] });
      case "advisory":
        return Object.assign(base, { drug: sc.drug.name, body: `<div class="sq-band warn">CLINICAL ADVISORY</div><div class="sq-center">HIGH ALERT medication.<br>Independent double check required.</div>${sc.drug.note ? `<p class="sq-hint">${sc.drug.note}</p>` : ""}`,
          soft: [null, null, null, K("continue", () => afterAdvisory(sc))] });
      case "bag":
        return Object.assign(base, { drug: sc.drug.name, sub: concLabel(sc.drug, sc.conc), body: `<p class="sq-prompt">Select delivery bag and press OK.</p>${listHTML(sc)}`, soft: [K("back", () => toSearch(false)), K("▲", move(-1)), K("▼", move(1)), null] });
      case "setup": return setupSpec(base, sc, setupDrug(sc.draft));
      case "limit": {
        const { lim, draft } = sc;
        const dirWord = lim.dir === "max" ? "upper" : "lower";
        if (lim.kind === "hard") {
          return Object.assign(base, setupDrug(draft), { body: `<div class="sq-pop">${lim.dir === "max" ? "Above UPPER" : "Below LOWER"} Hard Limit<br>Enter a value of ${fmtNum(lim.limit, 3)} ${lim.dir === "max" ? "or lower" : "or higher"}</div>`,
            soft: [null, null, null, K("OK", () => { draft[hasDose(draft) ? "dose" : "rate"] = null; draft.rate = hasDose(draft) ? null : draft.rate; if (!hasDose(draft)) { draft.rate = null; draft.time = null; } draft.field = hasDose(draft) ? "dose" : "rate"; go(sc.back === "change" ? "change" : "setup", sc.back === "change" ? { draft, what: hasDose(draft) ? "dose" : "rate" } : { draft }); })], alert: "hard" });
        }
        return Object.assign(base, setupDrug(draft), { body: `<div class="sq-band bad">SOFT LIMIT</div><div class="sq-center">${lim.dir === "max" ? "Above" : "Below"} ${dirWord} limit of<br>${fmtNum(lim.limit, 3)} ${lim.unit}.</div><div class="sq-center sq-q">Accept ${fmtNum(lim.val, 3)} ${lim.unit}?</div>`,
          soft: [K("yes", () => { draft.overrides.push({ dir: lim.dir, val: lim.val, limit: lim.limit }); log("override", { ch: "A", drugId: draft.drugId, val: lim.val, limit: lim.limit, dir: lim.dir });
            if (sc.back === "change") go("change", { draft, what: hasDose(draft) ? "dose" : "rate", ready: true }); else { nextField(draft); go("setup", { draft }); } }),
            K("no", () => { log("softReenter", { ch: "A" }); const f = hasDose(draft) ? "dose" : "rate"; draft[f] = null; draft.field = f; go(sc.back === "change" ? "change" : "setup", { draft, what: f }); }), null, null] });
      }
      case "checkFlow":
        return Object.assign(base, { title: "CHECK FLOW", body: sc.draft.secondary
          ? `<div class="sq-center sq-q">Are drops falling in the SECONDARY drip chamber and <u>not</u> in the PRIMARY?</div>`
          : `<ul class="sq-check"><li>Are all clamps open?</li><li>No kinks in tubing?</li><li>Are drops flowing?</li></ul>`,
          soft: [K("yes", () => startDraft(sc.draft)), K("no", () => { flash("Check clamps, kinks and the drip chamber, then press RUN/STOP", "warn"); go("setup", { draft: sc.draft }); }), null, null] });
      case "bagInfusing":
        return Object.assign(base, { body: `<div class="sq-center sq-big2">${sc.secondary ? "Secondary" : "Primary"} Bag<br>Infusing</div>` });
      case "run": return runSpec(base);
      case "stopped":
        return Object.assign(base, { drug: drugLabel(c.primary), sub: c.primary && c.primary.conc && c.primary.conc.amt ? concLabel(c.primary.drug, c.primary.conc) : "", body: `<div class="sq-center sq-big2">Pump<br>Stopped</div>`,
          soft: [null, K("program pri / sec", () => go("primaryReview")), K("info / settings", () => go("info", { back: "stopped" })), K("clear program", () => go("clearConfirm"))] });
      case "primaryReview": {
        const p = c.primary;
        return Object.assign(base, { drug: drugLabel(p), sub: p.conc && p.conc.amt ? concLabel(p.drug, p.conc) : "", body: `<div class="sq-bag">Primary Bag</div>${rowsHTML(p, null, true)}<p class="sq-hint">RUN/STOP resumes the primary. program secndry sets up a secondary.</p>`,
          soft: [null, null, K("program secndry", () => toSearch(true)), K("back", () => go("stopped"))] });
      }
      case "clearConfirm":
        return Object.assign(base, { body: `<div class="sq-center sq-q">Clear the current program?</div>`,
          soft: [K("yes", () => { const b = c.bedside; S.channels.A = Object.assign(newChannel("A"), { bedside: b }); log("channelOff", { ch: "A" }); toSearch(false); }), K("no", () => go("stopped")), null, null] });
      case "change": return changeSpec(base, sc, setupDrug(sc.draft));
      case "info":
        return Object.assign(base, { body: `<p class="sq-prompt">Information</p><div class="sq-rows"><div><span>Volume infused</span><b>${fmtNum(c.vi, 1)} mL</b></div><div><span>Patient weight</span><b>${S.weight ? fmtNum(S.weight, 1) + " kg" : "—"}</b></div></div>`,
          soft: [K("back", () => go(sc.back || "run")), null, null, null] });
    }
    return base;
  }

  function listHTML(sc) {
    const start = Math.max(0, Math.min(sc.cur - 3, sc.list.length - 7));
    return `<ul class="sq-list">${sc.list.slice(start, start + 7).map((it, i) => `<li class="${start + i === sc.cur ? "on" : ""}">${it.label}</li>`).join("")}</ul>`;
  }

  function rowsHTML(d, activeField, readOnly) {
    const row = (f, label, unit, val, digits) => {
      const on = !readOnly && activeField === f;
      const shown = on && S.buffer !== "" ? (f === "time" ? fmtTime(parseTime(S.buffer)) : S.buffer) : f === "time" ? fmtTime(val) : val == null ? "0" : fmtNum(val, digits);
      return `<div class="${on ? "on" : ""}"><span>${label} <small>${unit}</small></span><b>${shown}</b></div>`;
    };
    let h = "";
    if (hasDose(d) && d.drug.dose.perKg) h += row("weight", "Patient Weight", "kg", S.weight, 1);
    if (hasDose(d)) h += row("dose", "Dose", doseUnitLabel(d.drug), d.dose, 3);
    h += row("rate", "Rate", "mL/hr", d.rate, 1) + row("vtbi", "VTBI", "mL", d.vtbi, 1) + row("time", "Time", "hr:min", d.time);
    const total = !readOnly && activeField === "total";
    return `<div class="sq-rows">${h}<div class="sq-total${total ? " on" : ""}"><span>Total given <small>mL</small></span><b>${fmtNum(ch().vi, 1)}</b></div></div>`;
  }

  function setupSpec(base, sc, head) {
    const d = sc.draft;
    const pop = sc.vtbiPopup ? `<div class="sq-note">Secondary VTBI should equal Secondary bag volume<br><b>Press OK to confirm VTBI</b></div>` : "";
    return Object.assign(base, head, {
      body: `<div class="sq-bag">${d.secondary ? "Secondary" : "Primary"} Bag${d.mode === "basic" ? " · Basic mode (no limits)" : ""}</div>${rowsHTML(d, d.field)}${pop}${d.secondary ? `<div class="sq-2">2</div>` : ""}`,
      soft: [K("clear program", () => { d.secondary ? go("primaryReview") : toSearch(false); }), K("▲", () => { const fs = fieldsFor(d).concat(["total"]); const i = fs.indexOf(d.field); S.buffer = ""; d.field = fs[Math.max(0, i - 1)]; emit(); }), null,
        d.field && d.field !== "total" ? K(`clear ${d.field === "vtbi" ? "VTBI" : d.field}`, () => { S.buffer = ""; if (d.field === "weight") S.weight = null; else d[d.field] = null; if (["dose", "rate", "time"].includes(d.field)) { d.rate = null; d.time = null; if (hasDose(d)) d.dose = d.field === "dose" ? null : d.dose; } emit(); }) : null],
      prompt: d.field === "total" ? "Press RUN/STOP to start" : "Enter value, press OK",
    });
  }

  function runSpec(base) {
    const c = ch();
    const p = c.onSecondary && c.secondary ? c.secondary : c.primary;
    if (!p) return base;
    const hi = p.overrides.some((o) => o.dir === "max"), lo = p.overrides.some((o) => o.dir === "min");
    return Object.assign(base, {
      drug: drugLabel(p), sub: p.conc && p.conc.amt ? concLabel(p.drug, p.conc) : "", big: true, soft_red: hi || lo,
      body: `<div class="sq-rate${hi || lo ? " red" : ""}">${fmtNum(currentRate(c), 1)}</div><div class="sq-unit">mL/hr${hi ? ' <span class="sq-hi">HI</span>' : lo ? ' <span class="sq-hi">LO</span>' : ""}</div>
        <div class="sq-runinfo">${hasDose(p) ? `${fmtNum(p.dose, 3)} ${doseUnitLabel(p.drug)} · ` : ""}VTBI ${fmtNum(p.remaining, 1)} mL${c.onSecondary ? " · SECONDARY" : ""}${c.state === "kvo" ? " · KVO" : ""}</div>
        <div class="sq-bagicon${c.onSecondary ? " sec" : ""}"></div>`,
      soft: [null, K("review / edit VTBI", () => openChange("vtbi")), K("info / settings", () => go("info", { back: "run" })),
        hasDose(c.primary) ? K("dose change", () => openChange("dose")) : K("rate change", () => openChange("rate"))],
    });
  }

  function changeSpec(base, sc, head) {
    const d = sc.draft, l = d.drug ? d.drug.limits : {};
    const f = sc.what, unit = f === "dose" ? doseUnitLabel(d.drug) : f === "rate" ? "mL/hr" : "mL";
    const title = f === "dose" ? "DOSE CHANGE" : f === "rate" ? "RATE CHANGE" : "EDIT VTBI";
    const val = S.buffer !== "" ? S.buffer : fmtNum(d[f], 3);
    const limits = f !== "vtbi" && d.mode === "guardrails" ? `<div class="sq-limits"><u>SOFT LIMITS</u><div><span>Upper ${unit}</span><b>${l.softMax != null ? fmtNum(l.softMax, 3) : "—"}</b></div><div><span>Lower ${unit}</span><b>${l.softMin != null ? fmtNum(l.softMin, 3) : "—"}</b></div></div>` : "";
    return Object.assign(base, head, {
      title,
      body: `<div class="sq-bag">Primary Bag</div><div class="sq-rows"><div class="on"><span>${f === "dose" ? "Dose" : f === "rate" ? "Rate" : "VTBI"} <small>${unit}</small></span><b>${val}<i class="cursor"></i></b></div>${f === "dose" ? `<div><span>Rate <small>mL/hr</small></span><b>${fmtNum(d.rate, 1)}</b></div>` : ""}</div>${limits}`,
      soft: [K("cancel", () => go("run")), null, null, K(`clear ${f === "vtbi" ? "VTBI" : f}`, () => { S.buffer = ""; d[f] = null; emit(); })],
      prompt: sc.ready ? "Press RUN/STOP to begin" : "Enter value, press OK",
    });
  }

  function render() {
    if (S.flash && Date.now() > S.flash.until) S.flash = null;
    const sp = spec(), c = ch();
    if (c.alarm && ["run", "stopped", "primaryReview", "info"].includes(S.screen.id)) {
      const quiet = Date.now() < S.silencedUntil;
      sp.alarm = c.alarm;
      sp.alert = c.alarm.level === "high" ? "hard" : "soft";
      sp.soft[0] = quiet ? null : K("silence", () => key("SILENCE"));
      if (c.alarm.type === "complete") sp.soft[1] = K("review / edit VTBI", () => { c.alarm = null; openChange("vtbi"); });
    }
    S.spec = sp;
    return S.spec;
  }

  // Screens where a program is being set up and not yet started.
  function pending() {
    const sc = S.screen;
    if (["drugList", "concList", "confirm", "advisory", "bag", "setup", "limit", "checkFlow"].includes(sc.id)) return true;
    return sc.id === "change" && (S.buffer !== "" || sc.ready);
  }

  function bedside(chId, action, arg) {
    const b = ch().bedside;
    const acts = {
      prime: () => { b.primed = true; b.air = false; b.primaryBag = arg ? arg.vol + 10 : 1010; b.primaryBagName = arg ? arg.name : "Primary bag"; },
      load: () => (b.loaded = true), unload: () => (b.loaded = false), trace: () => (b.traced = true), clamp: () => (b.clampOpen = !b.clampOpen),
      fixOcclusion: () => (b.occluded = false), clearAir: () => { b.air = false; b.primed = true; },
      hangSecondary: () => { b.secondaryHung = true; b.secondaryBag = arg ? arg.vol : 100; b.secondaryBagName = arg ? arg.name : "Secondary bag"; },
      secClamp: () => (b.secondaryClampOpen = !b.secondaryClampOpen),
    };
    if (acts[action]) acts[action]();
    log("bedside", { ch: "A", action, clampOpen: b.clampOpen });
    emit();
  }

  const READY = { primed: true, loaded: true, traced: true, clampOpen: true };

  // Mid-shift setup used by practice mode (same config shape as the modular pump).
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
      c.primary = { mode: "guardrails", drugId: a.drugId, drug, conc, dose, rate, vtbi: a.vtbi, remaining: a.remaining != null ? a.remaining : a.vtbi, duration: null, overrides: [], weight: S.weight };
      c.state = "running";
      S.screen = { id: "run" };
    } else {
      S.letters = ""; S.screen = { id: "drugSearch" };
    }
    emit();
  }

  // Free practice: powered off, lines ready including a hung secondary.
  function freeSetup() {
    reset();
    Object.assign(ch().bedside, READY, { primaryBag: 5000, primaryBagName: "Primary bag", secondaryHung: true, secondaryClampOpen: true, secondaryBag: 5000, secondaryBagName: "Secondary bag" });
    emit();
  }

  reset();
  return {
    get state() { return S; }, reset, preset, freeSetup, tick, render, onChange, emit, log, flash,
    power, key, softKey, bedside, pending, currentRate, drugLabel, hasDose, doseUnit, LETTERS,
  };
})();
