/*
 * Syringe pump simulator, modeled on the Medfusion 3500 workflow as used on
 * the pediatric units (instructor notes + the v5 Quick Reference Card):
 *   Power -> self test -> Select mode (mL/hr, Volume/Time, Dose/Time,
 *   Dose/kg, Recall last settings; dose modes pick a drug program) ->
 *   Select syringe type (B-D, Monoject, Terumo) -> load syringe (size is
 *   recognized; 1 and 3 mL sizes must be confirmed) -> enter the settings ->
 *   confirm -> "Press START to begin" / "Press BOLUS to prime" (prime = press
 *   and hold BOLUS, EXIT when done) -> START. Intermittent and volume/time
 *   infusions offer a line flush when they finish.
 * Menus are picked by pressing the item's number; numbers are confirmed with
 * ENTER. For education only: not the manufacturer's software.
 */

const Syringe = (() => {
  const BOOT_MS = 3000;
  const SIZES = [1, 3, 5, 10, 20, 30, 60];
  const BRANDS = ["B-D", "MONOJECT", "TERUMO"];
  const PER_PAGE = 8;
  const PRIME_ML_PER_S = 0.25;
  const NEAR_MIN = 5;
  let S;
  const listeners = [];
  let bootTimer = null;
  // The last program ("Recall last settings"), kept like the pump's memory.
  let lastSettings = null;

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
      primeVol: 0, bolusDownAt: null,
      syringe: null, loaded: false, // the syringe at the bedside (brand and size printed on it)
      silencedUntil: 0, flash: null, log: [],
    };
    emit();
  }

  const log = (type, data = {}) => S.log.push(Object.assign({ t: S.t, type, pump: "syr" }, data));
  const onChange = (fn) => listeners.push(fn);
  function emit() { listeners.forEach((fn) => fn(S)); }
  function flash(text, kind = "info") { S.flash = { text, kind, until: Date.now() + 3200 }; }
  function go(id, ctx = {}) { S.screen = Object.assign({}, ctx, { id }); S.buffer = ""; emit(); }
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const ch = () => S.channels.A;
  const U = (s) => String(s).toUpperCase();

  // ------------------------------------------------------------ modes and math
  const MODES = [
    { pm: "mlhr", label: "ML/HR" },
    { pm: "voltime", label: "VOLUME/TIME" },
    { pm: "dose", label: "DOSE/TIME" },
    { pm: "dosekg", label: "DOSE/KG (BODY WEIGHT)" },
  ];
  const isDoseMode = (d) => !!d && (d.pm === "dose" || d.pm === "dosekg");
  const isInt = (d) => !!(d && d.drug && d.drug.mode === "int");
  function modeLabel(d) {
    if (d.pm === "mlhr") return "ML/HR";
    if (d.pm === "voltime") return "VOLUME/TIME";
    if (d.pm === "dose") return "DOSE/TIME";
    if (d.pm === "flush") return "FLUSH";
    return !d.drug || isInt(d) ? "DOSE/KG" : `DOSE/KG/${d.drug.dose.time === "min" ? "MIN" : "HR"}`;
  }
  // The drug as dosed in the chosen mode (dose/time drops the per-kg part).
  const effDrug = (d) => (d.pm === "dose" && !isInt(d) ? { dose: Object.assign({}, d.drug.dose, { perKg: false }) } : d.drug);
  function doseUnit(p) {
    if (!p || !isDoseMode(p) || !p.drug) return "ML/HR";
    if (isInt(p)) return p.pm === "dosekg" ? `${U(p.drug.dose.unit)}/KG` : U(p.drug.dose.unit);
    return U(doseUnitLabel(effDrug(p)));
  }
  const hasDose = (p) => isDoseMode(p);
  const concOf = (d) => d.drug.concs[0];
  // Concentration per mL in the dose's unit (20 MCG/ML, not 0.02 MG/ML).
  function concText(drug) {
    const c = drug.concs[0], u = drug.dose.unit;
    const mass = (x) => ["mg", "mcg", "g"].includes(x);
    const same = UNIT_FACTORS[u] != null && UNIT_FACTORS[c.unit] != null && (u === c.unit || (mass(u) && mass(c.unit)));
    const per = same ? (c.amt * UNIT_FACTORS[c.unit]) / UNIT_FACTORS[u] / c.vol : c.amt / c.vol;
    return `${fmtNum(per, 3)} ${U(same ? u : c.unit)}/ML`;
  }
  // Total amount for an intermittent dose (dose/kg mode multiplies by weight).
  const totalDose = (d) => (d.dose == null ? null : d.pm === "dosekg" && isInt(d) ? r3(d.dose * d.weight) : d.dose);
  const titleOf = (d) => (d && d.drug ? d.drug.prog : d ? modeLabel(d) : "");
  const drugLabel = (p) => titleOf(p);

  function recalc(d) {
    if (d.pm === "mlhr" || d.pm === "flush") return;
    if (d.pm === "voltime") { d.rate = d.vtbi && d.time ? r2(d.vtbi / (d.time / 60)) : null; return; }
    if (isInt(d)) {
      const t = totalDose(d);
      d.vtbi = t ? r3(t / (concOf(d).amt / concOf(d).vol)) : null;
      d.rate = d.vtbi && d.time ? r2(d.vtbi / (d.time / 60)) : null;
    } else if (d.dose != null && (d.pm === "dose" || d.weight)) d.rate = r2(doseToRate(effDrug(d), concOf(d), d.dose, d.weight));
  }

  // "30" = 30 min, "130" = 1 h 30 min
  function parseTime(buf) {
    const dg = buf.replace(/\D/g, "");
    if (!dg) return NaN;
    return dg.length <= 2 ? +dg : +dg.slice(0, -2) * 60 + +dg.slice(-2);
  }
  const fmtTime = (m) => (m == null ? "--:--:--" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}:${String(Math.round((m * 60) % 60)).padStart(2, "0")}`);

  // Limits (dose modes only): continuous = per kg per time; intermittent = per kg per dose.
  function limitCheck(d, dose) {
    if (!isDoseMode(d) || !d.drug) return null;
    if (d.pm === "dose" && (!isInt(d) || !d.weight)) return null;
    const l = d.drug.limits;
    const v = isInt(d) ? (d.pm === "dosekg" ? dose : dose / d.weight) : dose;
    const unit = isInt(d) ? `${U(d.drug.dose.unit)}/KG` : doseUnit(d);
    if (l.hardMax != null && v > l.hardMax + 1e-9) return { kind: "hard", dir: "max", v, limit: l.hardMax, unit };
    if (l.hardMin != null && v < l.hardMin - 1e-9) return { kind: "hard", dir: "min", v, limit: l.hardMin, unit };
    const done = (dir) => d.overrides.some((o) => o.dir === dir && Math.abs(o.dose - dose) < 1e-9);
    if (l.softMax != null && v > l.softMax + 1e-9 && !done("max")) return { kind: "soft", dir: "max", v, limit: l.softMax, unit };
    if (l.softMin != null && v < l.softMin - 1e-9 && !done("min")) return { kind: "soft", dir: "min", v, limit: l.softMin, unit };
    return null;
  }

  function fields(d) {
    if (d.pm === "mlhr") return ["rate"];
    if (d.pm === "voltime") return ["vtbi", "time"];
    const f = d.pm === "dosekg" ? ["weight", "dose"] : ["dose"];
    if (isInt(d)) f.push("time");
    return f;
  }

  // ------------------------------------------------------------ menus
  const modeList = () => MODES.map((m) => ({ label: m.label, pm: m.pm })).concat([{ label: "RECALL LAST SETTINGS", recall: true }]);
  function categoryList() {
    const cats = [];
    Object.values(SYR_DRUGS).forEach((d) => { if (!cats.includes(d.syrCat)) cats.push(d.syrCat); });
    return cats.sort().map((c) => ({ label: c, cat: c }));
  }
  const programList = (cat) => Object.values(SYR_DRUGS).filter((d) => d.syrCat === cat).map((d) => ({ label: d.prog, drug: d }));
  const toModes = () => go("mode", { list: modeList(), page: 0 });
  const toBrands = () => go("brand", { list: BRANDS.map((b) => ({ label: b, brand: b })), page: 0 });
  const randomSyringe = () => ({ brand: BRANDS[Math.floor(Math.random() * BRANDS.length)], size: SIZES[Math.floor(Math.random() * SIZES.length)] });
  const toLoad = () => { if (!S.syringe) S.syringe = randomSyringe(); go("load"); };
  // Load the syringe: the pump reads the size from 5 mL up; 1 and 3 mL must be confirmed.
  function loadSyringe() {
    const d = S.draft, sy = S.syringe;
    S.loaded = true; d.loadedSize = sy.size;
    log("bedside", { ch: "A", action: "load", size: sy.size, brand: sy.brand });
    if (sy.size <= 3) return go("confirmSize", { pick: null });
    go("recognized", { size: sy.size });
  }
  const toProgram = (cat) => go("program", { list: programList(cat), page: 0, cat });

  function pickNumber(n) {
    const sc = S.screen, it = sc.list[sc.page * PER_PAGE + n - 1];
    if (!it) return;
    if (sc.id === "mode") {
      if (it.recall) {
        if (!lastSettings) { flash("NO SETTINGS TO RECALL", "warn"); return emit(); }
        S.draft = Object.assign(JSON.parse(JSON.stringify(lastSettings)), { drug: lastSettings.drugId ? SYR_DRUGS[lastSettings.drugId] : null, overrides: [], syrType: null, syrSize: null, recalled: true });
        if (S.draft.weight) S.weight = S.draft.weight;
        log("recall", { ch: "A", pm: S.draft.pm });
        return toBrands();
      }
      S.draft = { pm: it.pm, drug: null, drugId: null, weight: S.weight, dose: null, time: null, rate: null, vtbi: null, overrides: [], field: null, syrType: null, syrSize: null };
      log("syrMode", { ch: "A", pm: it.pm });
      if (isDoseMode(S.draft)) return go("category", { list: categoryList(), page: 0 });
      return toBrands();
    }
    if (sc.id === "category") return toProgram(it.cat);
    if (sc.id === "program") {
      const d = S.draft;
      d.drug = it.drug; d.drugId = it.drug.id;
      log("drugSelected", { ch: "A", drugId: d.drugId, conc: concLabel(d.drug, concOf(d)), secondary: false });
      if (d.drug.highAlert) return go("advisory");
      return toBrands();
    }
    if (sc.id === "brand") { S.draft.syrType = it.brand; log("syringeType", { ch: "A", brand: it.brand }); return toLoad(); }

  }

  function toParams() {
    const d = S.draft;
    if (d.recalled) return go("ready");
    d.field = fields(d)[0];
    go("params");
  }

  // ------------------------------------------------------------ keys
  function power() {
    if (!S.on) {
      S.on = true; log("powerOn"); go("boot");
      bootTimer = setTimeout(() => { if (S.screen.id === "boot") toModes(); }, BOOT_MS);
      return;
    }
    if (ch().state === "running") { flash("STOP THE INFUSION BEFORE POWER OFF", "warn"); return emit(); }
    clearTimeout(bootTimer); S.on = false; log("powerOff"); go("off");
  }

  function key(k) {
    if (!S.on || S.screen.id === "boot") return;
    const sc = S.screen, c = ch();
    if (k === "SILENCE") {
      // A near-empty warning is cleared by SILENCE; other alarms are quiet for 2 min.
      if (c.alarm && c.alarm.level === "low") { c.alarm = null; log("silence"); return emit(); }
      S.silencedUntil = Date.now() + 120000; log("silence"); return emit();
    }
    if (k === "BOLUS") {
      if (sc.id === "ready") return go("prime");
      if (sc.id === "prime") return;
      flash("BOLUS IS NOT USED IN PRACTICE"); return emit();
    }
    if (k === "STOP") {
      if (c.state === "running") { c.state = "paused"; log("pause", { ch: "A" }); return go("run"); }
      if (c.state === "complete") return afterComplete();
      return;
    }
    if (k === "START") return startKey();
    if (k === "BACK") return back();
    if (/^[0-9]$/.test(k) && sc.list) { if (+k >= 1) pickNumber(+k); return; }

    if (sc.id === "params" || sc.id === "chgDose" || sc.id === "flushSet") {
      if (/^[0-9.]$/.test(k)) {
        const f = sc.id === "chgDose" ? "dose" : sc.id === "flushSet" ? "vtbi" : S.draft.field;
        if (k === "." && (S.buffer.includes(".") || f === "time")) return;
        if (S.buffer.length >= 7) return;
        S.buffer += k; return emit();
      }
      if (k === "ENTER") return sc.id === "chgDose" ? enterChange() : sc.id === "flushSet" ? enterFlush() : enterField();
    }
  }

  // Priming: press and hold BOLUS on the prime screen.
  function bolusDown() {
    if (!S.on || S.screen.id !== "prime" || S.bolusDownAt) return;
    S.bolusDownAt = Date.now(); emit();
  }
  function bolusUp() {
    if (!S.bolusDownAt) return;
    S.primeVol = r3(S.primeVol + ((Date.now() - S.bolusDownAt) / 1000) * PRIME_ML_PER_S);
    S.bolusDownAt = null; emit();
  }
  const primeNow = () => r3(S.primeVol + (S.bolusDownAt ? ((Date.now() - S.bolusDownAt) / 1000) * PRIME_ML_PER_S : 0));
  function exitPrime() {
    bolusUp();
    const v = S.primeVol;
    log("bedside", { ch: "A", action: "prime", volume: v });
    if (v > 0) flash(`PRIMED ${fmtNum(v, 2)} ML`);
    S.primeVol = 0;
    go("ready");
  }

  function back() {
    const sc = S.screen;
    if (S.buffer) { S.buffer = ""; return emit(); }
    const d = S.draft;
    if (sc.id === "category") return toModes();
    if (sc.id === "program") return go("category", { list: categoryList(), page: 0 });
    if (sc.id === "advisory") return toProgram(d.drug.syrCat);
    if (sc.id === "brand") return isDoseMode(d) && d.drug ? toProgram(d.drug.syrCat) : toModes();
    if (sc.id === "load") return toBrands();
    if (["recognized", "confirmSize"].includes(sc.id)) { S.loaded = false; return toLoad(); }
    if (sc.id === "params") { const i = fields(d).indexOf(d.field); if (i > 0) { d.field = fields(d)[i - 1]; return emit(); } return toLoad(); }
    if (sc.id === "ready") { d.recalled = false; d.field = fields(d).slice(-1)[0]; return go("params"); }
    if (sc.id === "prime") return exitPrime();
    if (sc.id === "chgDose") return go("run");
  }

  function enterField() {
    const d = S.draft, f = d.field;
    if (S.buffer === "" && (f === "weight" ? d.weight == null : d[f] == null)) { flash("ENTER A VALUE", "warn"); return emit(); }
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
    go("ready");
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
    go("ready");
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
    if (sc.id === "flushSet" && sc.vol) return startFlush(sc.vol);
    if (sc.id === "chgDose" && sc.pending != null) {
      const p = c.primary, from = { dose: p.dose, rate: p.rate };
      p.dose = sc.pending; p.rate = r2(doseToRate(effDrug(p), concOf(p), p.dose, p.weight));
      p.overrides = S.draft.overrides.slice();
      log("titrate", { ch: "A", drugId: p.drugId, fromDose: from.dose, toDose: p.dose, fromRate: from.rate, toRate: p.rate, state: c.state });
      return go("run");
    }
    if (c.state === "paused" && c.primary) { c.state = "running"; log("resume", { ch: "A", fromAlarm: null }); return go("run"); }
    if (["params", "brand", "load", "recognized", "confirmSize", "prime"].includes(sc.id)) { flash("FINISH PROGRAMMING FIRST", "warn"); return emit(); }
  }

  function startInfusion() {
    const d = S.draft, c = ch();
    const finite = isInt(d) || d.pm === "voltime";
    const prog = { mode: "guardrails", pm: d.pm, drugId: d.drugId, drug: d.drug, conc: d.drug ? concOf(d) : null, dose: d.dose, rate: d.rate, vtbi: d.vtbi, time: d.time,
      remaining: finite ? d.vtbi : d.syrSize || 50, given: 0, weight: d.weight, overrides: d.overrides.slice(), syrType: d.syrType, syrSize: d.syrSize, int: finite, flushable: finite };
    c.primary = prog; c.state = "running"; c.alarm = null;
    lastSettings = { pm: d.pm, drugId: d.drugId, weight: d.weight, dose: d.dose, time: d.time, rate: d.rate, vtbi: d.vtbi };
    log("start", { ch: "A", drugId: d.drugId, mode: isDoseMode(d) ? "guardrails" : "basic", pm: d.pm, syrType: d.syrType, syrSize: d.syrSize, loadedSize: d.loadedSize,
      concVol: d.drug ? concOf(d).vol : null, concAmt: d.drug ? concOf(d).amt : null, dose: d.dose, total: isInt(d) && isDoseMode(d) ? totalDose(d) : null,
      rate: d.rate, vtbi: d.vtbi, time: d.time, weight: d.pm === "dosekg" ? d.weight : null, overrides: d.overrides.length, traced: true });
    go("run");
  }

  // ------------------------------------------------------------ end of infusion and flush
  function afterComplete() {
    const c = ch(), p = c.primary;
    c.alarm = null;
    if (p && p.flushable) return go("flushAsk");
    c.state = "idle"; c.primary = null;
    newSyringe(); toModes();
  }
  // After an infusion the next program uses a new syringe (practice: random).
  function newSyringe() { if (!S.fixedSyringe) { S.syringe = null; S.loaded = false; } }
  function enterFlush() {
    if (S.buffer === "") return;
    const v = parseFloat(S.buffer);
    S.buffer = "";
    if (isNaN(v) || v <= 0) { flash("INVALID ENTRY", "warn"); return emit(); }
    go("flushSet", { vol: v });
  }
  function startFlush(vol) {
    const c = ch(), p = c.primary;
    const rate = p ? p.rate : 5;
    c.primary = { mode: "basic", pm: "flush", drugId: null, drug: null, rate, vtbi: vol, remaining: vol, given: 0, overrides: [], int: true, flushable: false };
    c.state = "running"; c.alarm = null;
    log("flush", { ch: "A", vtbi: vol, rate });
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
      // Near-empty warning: 5 min or less left; the infusion keeps running.
      if (!p.nearWarned && p.pm !== "flush" && p.rate && ((p.remaining + p.given) / p.rate) * 60 > 2 * NEAR_MIN && (p.remaining / p.rate) * 60 <= NEAR_MIN && p.remaining > 0.00001) {
        p.nearWarned = true;
        c.alarm = { type: "near", msg: p.int ? "NEAR END OF INFUSION" : "SYRINGE NEAR EMPTY", level: "low" };
        S.silencedUntil = 0; log("alarm", { ch: "A", alarm: "near" });
      }
      if (p.remaining <= 0.00001) {
        const msg = p.pm === "flush" ? "FLUSH COMPLETE" : p.int ? "INFUSION COMPLETE" : "SYRINGE EMPTY";
        c.state = "complete"; c.alarm = { type: "complete", msg, level: "high" };
        S.silencedUntil = 0; log("alarm", { ch: "A", alarm: "complete" }); log("complete", { ch: "A" });
      }
    }
    emit();
  }
  function currentRate(c) { return c.state === "running" && c.primary ? c.primary.rate : 0; }

  // ------------------------------------------------------------ screens
  const K = (label, fn) => ({ label, fn });
  const pageKey = () => K("MORE", () => { const sc = S.screen; const pages = Math.ceil(sc.list.length / PER_PAGE); sc.page = (sc.page + 1) % pages; emit(); });
  function menuSpec(prompt, extraSoft) {
    const sc = S.screen;
    const items = sc.list.slice(sc.page * PER_PAGE, sc.page * PER_PAGE + PER_PAGE).map((it, i) => ({ n: i + 1, label: it.label }));
    const more = sc.list.length > PER_PAGE;
    return { menu: items, prompt, soft: [extraSoft || null, null, null, more ? pageKey() : null], page: more ? `${sc.page + 1}/${Math.ceil(sc.list.length / PER_PAGE)}` : "" };
  }

  function rowsFor(d, active) {
    const val = (f, v, fmt) => (active === f && S.buffer !== "" ? (f === "time" ? fmtTime(parseTime(S.buffer)) : S.buffer) : v == null ? "---" : fmt(v));
    const n3 = (x) => fmtNum(x, 3);
    const rows = [];
    if (d.drug) rows.push({ k: "CONC", v: concText(d.drug) });
    rows.push({ k: "MODE", v: modeLabel(d) });
    if (d.syrSize) rows.push({ k: "SYRINGE", v: `${d.syrType} ${d.syrSize} ML` });
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
    const base = { title: "", unit: "", prompt: "", soft: [null, null, null, null] };
    switch (sc.id) {
      case "off": return { off: true };
      case "boot": return { boot: true };
      case "mode": return Object.assign(base, { title: "SELECT MODE" }, menuSpec("PRESS THE NUMBER TO SELECT"));
      case "category": return Object.assign(base, { title: `${modeLabel(d)} · DRUG LIBRARY` }, menuSpec("SELECT CATEGORY - PRESS THE NUMBER", K("CHG MODE", toModes)));
      case "program": return Object.assign(base, { title: sc.cat }, menuSpec("SELECT DRUG PROGRAM - PRESS THE NUMBER", K("CHG MODE", toModes)));
      case "advisory": return Object.assign(base, { title: d.drug.prog, msg: "HIGH ALERT MEDICATION<br>INDEPENDENT DOUBLE CHECK", prompt: "PRESS CONFIRM TO CONTINUE", soft: [null, null, null, K("CONFIRM", toBrands)] });
      case "brand": return Object.assign(base, { title: titleOf(d) }, menuSpec("SELECT SYRINGE TYPE - PRESS THE NUMBER"));
      case "load": return Object.assign(base, { title: `LOAD ${d.syrType} SYRINGE`, msg: "LIFT THE BARREL CLAMP, SEAT THE FLANGE,<br>ADVANCE THE PLUNGER DRIVER, LOWER THE CLAMP", prompt: "LOAD THE SYRINGE", soft: [null, null, null, K("LOAD SYRINGE", loadSyringe)] });
      case "recognized": return Object.assign(base, { title: titleOf(d), msg: `SYRINGE RECOGNIZED<br><b class="sy-size">${d.syrType} ${sc.size} ML</b>`, prompt: "VERIFY SYRINGE MODEL AND SIZE", soft: [null, null, null, K("CONFIRM", () => { d.syrSize = sc.size; log("syringeSize", { ch: "A", size: sc.size, loaded: sc.size }); toParams(); })] });
      case "confirmSize": {
        const pick = (n) => () => { sc.pick = n; emit(); };
        return Object.assign(base, { title: `${d.syrType} SYRINGE`, msg: `CONFIRM SYRINGE SIZE<br><b class="sy-size">${sc.pick ? `${sc.pick} ML` : "1 ML OR 3 ML?"}</b>`, prompt: sc.pick ? "PRESS CONFIRM" : "SELECT THE SIZE LOADED",
          soft: [K(sc.pick === 1 ? "[1 ML]" : "1 ML", pick(1)), K(sc.pick === 3 ? "[3 ML]" : "3 ML", pick(3)), null,
            sc.pick ? K("CONFIRM", () => { d.syrSize = sc.pick; log("syringeSize", { ch: "A", size: sc.pick, loaded: d.loadedSize }); toParams(); }) : null] });
      }
      case "params": {
        const f = d.field;
        const ask = { weight: "ENTER WEIGHT (KG)", dose: `ENTER DOSE (${doseUnit(d)})`, time: "ENTER TIME (30 = 30 MIN, 100 = 1 HR)", rate: "ENTER RATE (ML/HR)", vtbi: "ENTER VOLUME (ML)" }[f];
        return Object.assign(base, { title: titleOf(d), rows: rowsFor(d, f), prompt: `${ask} - PRESS ENTER` });
      }
      case "softMsg": return Object.assign(base, { title: titleOf(d), msg: `DOSE ${sc.lim.dir === "max" ? "ABOVE" : "BELOW"} SOFT LIMIT<br>${fmtNum(sc.lim.v, 3)} ${sc.lim.unit} (LIMIT ${fmtNum(sc.lim.limit, 3)})<br>OVERRIDE?`, alert: "soft",
        soft: [K("YES", () => { d.overrides.push({ dir: sc.lim.dir, dose: sc.dose }); log("override", { ch: "A", drugId: d.drugId, val: sc.dose, dir: sc.lim.dir }); acceptDose(sc.dose, sc.back); }), null, null,
          K("NO", () => { log("softReenter", { ch: "A" }); if (sc.back === "chgDose") return go("chgDose"); d.field = "dose"; go("params"); })] });
      case "hardMsg": return Object.assign(base, { title: titleOf(d), msg: `DOSE ${sc.lim.dir === "max" ? "ABOVE" : "BELOW"} HARD LIMIT<br>${fmtNum(sc.lim.v, 3)} ${sc.lim.unit}<br>${sc.lim.dir === "max" ? "MAXIMUM" : "MINIMUM"} ${fmtNum(sc.lim.limit, 3)} ${sc.lim.unit}`, alert: "hard",
        soft: [null, null, null, K("OK", () => { if (sc.back === "chgDose") return go("chgDose"); d.field = "dose"; go("params"); })] });
      case "ready": {
        // The prompt alternates between starting and priming.
        const alt = Math.floor(Date.now() / 2000) % 2 === 0;
        return Object.assign(base, { title: titleOf(d), rows: rowsFor(d, null), prompt: alt ? "PRESS START TO BEGIN INFUSION" : "PRESS BOLUS TO PRIME", soft: [K("CHG MODE", toModes), null, K("OPTIONS", options), null] });
      }
      case "prime": return Object.assign(base, { title: "PRIME", msg: `${S.bolusDownAt ? "PRIMING..." : "PRESS AND HOLD BOLUS KEY"}<br>PRIMING VOLUME <b class="sy-size">${fmtNum(primeNow(), 2)} ML</b>`, prompt: "PRESS EXIT WHEN PRIME IS COMPLETE", soft: [K("EXIT", exitPrime), null, null, null] });
      case "chgDose": return Object.assign(base, { title: c.primary.drug.prog, rows: [{ k: "CURRENT", v: `${fmtNum(c.primary.dose, 3)} ${doseUnit(c.primary)}` }, { k: "NEW DOSE", v: `${S.buffer !== "" ? S.buffer : sc.pending != null ? fmtNum(sc.pending, 3) : "---"} ${doseUnit(c.primary)}`, on: sc.pending == null, big: true },
        { k: "NEW RATE", v: sc.pending != null ? `${fmtNum(r2(doseToRate(effDrug(c.primary), concOf(c.primary), sc.pending, c.primary.weight)), 3)} ML/HR` : "---" }],
        prompt: sc.pending != null ? "PRESS START TO CONFIRM NEW DOSE" : "ENTER NEW DOSE - PRESS ENTER", soft: [K("CANCEL", () => go("run")), null, null, null] });
      case "flushAsk": return Object.assign(base, { title: titleOf(c.primary), msg: "INFUSION COMPLETE<br>FLUSH THE LINE?",
        soft: [K("FLUSH", () => go("flushSet", { vol: null })), null, null, K("NO FLUSH", () => { c.state = "idle"; c.primary = null; toModes(); })] });
      case "flushSet": return Object.assign(base, { title: "FLUSH", rows: [{ k: "FLUSH VOLUME", v: `${S.buffer !== "" ? S.buffer : sc.vol != null ? fmtNum(sc.vol, 3) : "---"} ML`, on: sc.vol == null, big: true }, { k: "RATE", v: `${fmtNum(c.primary ? c.primary.rate : 5, 3)} ML/HR` }],
        prompt: sc.vol != null ? "PRESS START TO BEGIN FLUSH" : "ENTER FLUSH VOLUME (ML) - PRESS ENTER", soft: [K("CANCEL", () => { c.state = "idle"; c.primary = null; toModes(); }), null, null, null] });
      case "run": return runSpec(base);
    }
    return base;
  }

  function options() { flash("OPTIONS ARE NOT USED IN PRACTICE"); emit(); }

  function runSpec(base) {
    const c = ch(), p = c.primary;
    if (!p) return base;
    const dm = isDoseMode(p);
    const rows = [];
    if (p.drug) rows.push({ k: "CONC", v: concText(p.drug) });
    rows.push({ k: "TVD", v: `${fmtNum(c.vi, 3)} ML` });
    if (p.pm === "dosekg") rows.push({ k: "WEIGHT", v: `${fmtNum(p.weight, 3)} KG` });
    else rows.push({ k: "MODE", v: modeLabel(p) });
    if (dm) rows.push({ k: "DOSE", v: `${fmtNum(p.dose, 3)} ${doseUnit(p)}`, big: true, rev: p.overrides.length > 0 }, { k: "RATE", v: `${fmtNum(p.rate, 3)} ML/HR` });
    else rows.push({ k: "RATE", v: `${fmtNum(p.rate, 3)} ML/HR`, big: true });
    if (p.int) rows.push({ k: "TIME REMAINING", v: fmtTime(p.rate ? (p.remaining / p.rate) * 60 : 0) });
    const running = c.state === "running";
    const canChg = dm && !p.int;
    return Object.assign(base, {
      title: titleOf(p), rows, running, alarm: c.alarm,
      prompt: c.state === "paused" ? "PAUSED - PRESS START TO RESUME" : c.state === "complete" ? "PRESS STOP TO CONTINUE" : c.alarm && c.alarm.level === "low" ? "PRESS SILENCE TO ACKNOWLEDGE" : "",
      soft: running ? [K("LOCK", () => { flash("KEYPAD LOCK IS NOT USED IN PRACTICE"); emit(); }), canChg ? K("CHG DOSE", chgDose) : null, K("OPTIONS", options), K("CLEAR TVD", () => { c.vi = 0; log("clearVolume"); emit(); })]
        : [K("MAIN MENU", () => { c.primary = null; c.state = "idle"; toModes(); }), canChg ? K("CHG DOSE", chgDose) : null, K("OPTIONS", options), K("CLEAR TOTALS", () => { c.vi = 0; log("clearVolume"); emit(); })],
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
    if (["category", "program", "advisory", "brand", "load", "recognized", "confirmSize", "params", "softMsg", "hardMsg", "ready", "prime", "flushSet"].includes(sc.id)) return true;
    return sc.id === "chgDose" && (S.buffer !== "" || sc.pending != null);
  }

  function bedside(chId, action) { log("bedside", { ch: chId, action }); emit(); }

  // Practice setup: pump on at Select Mode, or a drip already running (titration).
  function preset(cfg) {
    reset();
    S.on = true; S.patientId = cfg.patientId || null;
    if (cfg.syringe) { S.syringe = Object.assign({}, cfg.syringe); S.fixedSyringe = true; }
    const a = (cfg.channels || []).find((x) => x.ch === "A");
    if (a && a.drugId && SYR_DRUGS[a.drugId]) {
      const drug = SYR_DRUGS[a.drugId], conc = drug.concs[0];
      S.profile = cfg.profile; S.weight = cfg.weight;
      const rate = r2(doseToRate(drug, conc, a.dose, S.weight));
      ch().primary = { mode: "guardrails", pm: "dosekg", drugId: a.drugId, drug, conc, dose: a.dose, rate, vtbi: 50, remaining: 30, given: 20, weight: S.weight, overrides: [], syrType: "B-D", syrSize: 60, int: false };
      ch().state = "running";
      S.syringe = { brand: "B-D", size: 60 }; S.loaded = true; S.fixedSyringe = true;
      S.screen = { id: "run" };
    } else S.screen = { id: "mode", list: modeList(), page: 0 };
    emit();
  }

  reset();
  return {
    get state() { return S; }, reset, preset, tick, render, onChange, emit, log, flash,
    power, key, softKey, bedside, pending, currentRate, drugLabel, hasDose, doseUnit, bolusDown, bolusUp,
  };
})();
