/*
 * Large-volume pump simulator engine, modeled on the programming workflow in
 * the BD Alaris System with Guardrails Suite MX user manual addendum
 * (PC unit with soft keys, LVP pump modules, Guardrails drug library).
 * For education only: not the manufacturer's software.
 */

const PUMP_MAX_RATE = 999;
const KVO_RATE = 1;
const PAUSE_REMINDER_SEC = 120;
const CHANNEL_IDS = ["A", "B"];
const HOSPITAL = "ATU Simulation Hospital";
const LETTER_GROUPS = [["A", "E"], ["F", "J"], ["K", "O"], ["P", "T"], ["U", "Z"]];
const PER_PAGE = 5;
const BOOT_MS = 5200;

const Pump = (() => {
  let S;
  const listeners = [];
  let bootTimer = null;

  function newBedside() {
    return {
      primed: false, loaded: false, traced: false, clampOpen: false,
      occluded: false, air: false,
      primaryBag: 0, primaryBagName: "",
      secondaryHung: false, secondaryClampOpen: false, secondaryBag: 0, secondaryBagName: "",
    };
  }

  function newChannel(id) {
    return {
      id, state: "idle", // idle | running | paused | alarm | kvo
      primary: null, secondary: null, onSecondary: false,
      vi: 0, pausedAt: null, alarm: null, bedside: newBedside(),
    };
  }

  function reset() {
    clearTimeout(bootTimer);
    S = {
      on: false, t: 0, profile: null, weight: null, patientId: null,
      channels: { A: newChannel("A"), B: newChannel("B") },
      screen: { id: "off" }, spec: null, buffer: "",
      silencedUntil: 0, flash: null, log: [], bootStart: 0,
    };
    emit();
  }

  function log(type, data = {}) { S.log.push(Object.assign({ t: S.t, type }, data)); }
  function logHas(type, pred) { return S.log.some((e) => e.type === type && (!pred || pred(e))); }
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach((fn) => fn(S)); }
  function flash(text, kind = "info") { S.flash = { text, kind, until: Date.now() + 3500 }; }

  function go(id, ctx = {}) {
    S.screen = Object.assign({}, ctx, { id });
    S.buffer = "";
    emit();
  }

  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;

  // ------------------------------------------------------------------
  // Library helpers
  // ------------------------------------------------------------------
  const isFluid = (d) => /fluid|blood/i.test(d.cls);
  function listFor(kind) {
    return profileDrugList(S.profile).filter((d) => (kind === "fluids" ? isFluid(d) : !isFluid(d)));
  }

  // ------------------------------------------------------------------
  // Program drafts
  // ------------------------------------------------------------------
  function newDraft(chId, opts) {
    return Object.assign({
      ch: chId, mode: "guardrails", drugId: null, drug: null, conc: null,
      dose: null, rate: null, vtbi: null, duration: null, durMode: false,
      field: null, overrides: [], callback: true, secondary: false, titrate: false, changed: false, edits: {},
    }, opts);
  }

  function drugLabel(p) {
    if (!p) return "";
    return p.mode === "basic" ? "Basic Infusion" : p.drug.name;
  }
  function doseUnit(p) { return p && p.drug ? doseUnitLabel(p.drug).replace("/hr", "/h") : "mL/h"; }
  function hasDose(p) { return !!(p && p.mode === "guardrails" && p.drug && p.drug.dose); }

  function recalc(d, from) {
    const w = S.weight;
    const perKgMissing = hasDose(d) && d.drug.dose.perKg && !w;
    if (hasDose(d) && !perKgMissing) {
      if (from === "dose" && d.dose != null) d.rate = r1(doseToRate(d.drug, d.conc, d.dose, w));
      else if (from === "rate" && d.rate != null) d.dose = r2(rateToDose(d.drug, d.conc, d.rate, w));
    }
    if ((from === "duration" || (from === "vtbi" && d.durMode)) && d.vtbi && d.duration) {
      d.rate = r1(d.vtbi / (d.duration / 60));
      if (hasDose(d) && !perKgMissing) d.dose = r2(rateToDose(d.drug, d.conc, d.rate, w));
    } else if (d.rate && d.vtbi) {
      d.duration = Math.round((d.vtbi / d.rate) * 60);
    }
  }

  // Duration is typed like the pump's h:mm field: "30" = 0:30, "130" = 1:30.
  function parseDuration(buf) {
    const digits = buf.replace(/\D/g, "");
    if (!digits) return NaN;
    if (digits.length <= 2) return parseInt(digits, 10);
    return parseInt(digits.slice(0, -2), 10) * 60 + parseInt(digits.slice(-2), 10);
  }

  function commitBuffer() {
    const sc = S.screen;
    if (sc.id !== "program" || !sc.draft.field || S.buffer === "") return true;
    const d = sc.draft;
    const v = d.field === "duration" ? parseDuration(S.buffer) : parseFloat(S.buffer);
    S.buffer = "";
    if (isNaN(v) || v <= 0) { flash("Invalid entry", "warn"); return false; }
    d[d.field] = v;
    d.changed = true;
    d.edits[d.field] = true;
    recalc(d, d.field);
    return true;
  }

  function selectField(f) {
    const d = S.screen.draft;
    if (!commitBuffer()) { emit(); return; }
    d.field = f;
    emit();
  }

  function limitCheck(d) {
    if (d.mode !== "guardrails") return null;
    const l = d.drug.limits;
    const val = hasDose(d) ? d.dose : d.rate;
    const unit = doseUnit(d);
    const what = hasDose(d) ? "Dose" : "Rate";
    if (l.hardMax != null && val > l.hardMax + 1e-9) return { kind: "hard", dir: "max", val, limit: l.hardMax, unit, what };
    if (l.hardMin != null && val < l.hardMin - 1e-9) return { kind: "hard", dir: "min", val, limit: l.hardMin, unit, what };
    const already = (dir) => d.overrides.some((o) => o.dir === dir && Math.abs(o.val - val) < 1e-9);
    if (l.softMax != null && val > l.softMax + 1e-9 && !already("max")) return { kind: "soft", dir: "max", val, limit: l.softMax, unit, what };
    if (l.softMin != null && val < l.softMin - 1e-9 && !already("min")) return { kind: "soft", dir: "min", val, limit: l.softMin, unit, what };
    return null;
  }

  function validate(d) {
    if (hasDose(d) && d.drug.dose.perKg && !S.weight) return "Enter patient weight";
    if (hasDose(d) && !d.dose) return "Select DOSE and enter a value";
    if (!d.rate) return "Select RATE and enter a value";
    if (!d.vtbi) return "Select VTBI and enter a value";
    if (d.rate > PUMP_MAX_RATE) return `Rate exceeds ${PUMP_MAX_RATE} mL/h pump maximum`;
    if (d.rate < 0.1) return "Rate below 0.1 mL/h minimum";
    return null;
  }

  // START soft key on a programming screen.
  function pressStart() {
    const d = S.screen.draft;
    if (!commitBuffer()) { emit(); return; }
    const ch = S.channels[d.ch];
    if (d.titrate && !d.changed) {
      if (ch.state === "paused" || ch.state === "alarm") return restart(d.ch);
      return go("main");
    }
    const err = validate(d);
    if (err) { flash(err, "warn"); emit(); return; }
    const lim = limitCheck(d);
    if (lim) {
      log(lim.kind === "hard" ? "hardLimit" : "softLimit", { ch: d.ch, drugId: d.drugId, val: lim.val, limit: lim.limit, dir: lim.dir });
      go("limit", { draft: d, lim });
      return;
    }
    beginInfusion(d);
  }

  function beginInfusion(d) {
    const ch = S.channels[d.ch], b = ch.bedside;
    if (!b.loaded) {
      flash(`Channel ${d.ch}: load the IV set and close the door`, "warn");
      log("startFailed", { ch: d.ch, reason: "notLoaded" });
      go("program", { draft: d });
      return;
    }
    const prog = {
      mode: d.mode, drugId: d.drugId, drug: d.drug, conc: d.conc,
      dose: d.dose, rate: d.rate, vtbi: d.vtbi, duration: d.duration,
      remaining: d.vtbi, overrides: d.overrides.slice(), callback: d.callback, weight: S.weight,
    };
    if (d.secondary) {
      ch.secondary = prog;
      ch.onSecondary = true;
      log("startSecondary", { ch: d.ch, drugId: d.drugId, mode: d.mode, rate: d.rate, vtbi: d.vtbi, dose: d.dose, concVol: d.conc && d.conc.vol, overrides: d.overrides.length, traced: b.traced, hung: b.secondaryHung, clamp: b.secondaryClampOpen });
      if (d.mode === "basic") log("basicInfusion", { ch: d.ch });
      run(ch);
    } else if (d.titrate && ch.primary) {
      const old = ch.primary;
      const e = d.edits;
      if (old.dose !== d.dose || old.rate !== d.rate) {
        log("titrate", { ch: d.ch, drugId: d.drugId, fromDose: old.dose, toDose: d.dose, fromRate: old.rate, toRate: d.rate, state: ch.state });
      }
      Object.assign(old, { dose: d.dose, rate: d.rate, overrides: old.overrides.concat(d.overrides) });
      if (e.vtbi) {
        Object.assign(old, { vtbi: d.vtbi, remaining: d.vtbi });
        log("newVtbi", { ch: d.ch, vtbi: d.vtbi, rate: d.rate });
      } else if (ch.state === "kvo") {
        flash("Enter a new VTBI to continue", "warn");
        go("program", { draft: d });
        return;
      }
      if (ch.state !== "running") run(ch);
    } else {
      ch.primary = prog;
      log("start", { ch: d.ch, drugId: d.drugId, mode: d.mode, concVol: d.conc && d.conc.vol, concAmt: d.conc && d.conc.amt, dose: d.dose, rate: d.rate, vtbi: d.vtbi, traced: b.traced, weight: S.weight, profile: S.profile, overrides: d.overrides.length, patientId: S.patientId });
      if (d.mode === "basic") log("basicInfusion", { ch: d.ch });
      run(ch);
    }
    go("main");
  }

  function run(ch) {
    ch.alarm = null;
    ch.pausedAt = null;
    ch.state = "running";
    if (!ch.bedside.primed) raiseAlarm(ch, "air");
  }

  function restart(chId) {
    const ch = S.channels[chId];
    if (!ch.primary) { flash(`Channel ${chId} is not programmed`, "warn"); emit(); return; }
    if (ch.state === "running") return;
    if (ch.state === "kvo") { flash("Infusion complete. Press CHANNEL SELECT and enter a new VTBI", "warn"); emit(); return; }
    if (!ch.bedside.loaded) { flash(`Channel ${chId}: load the IV set`, "warn"); emit(); return; }
    log("resume", { ch: chId, fromAlarm: ch.alarm ? ch.alarm.type : null });
    run(ch);
    if (S.screen.id === "program" && S.screen.draft.ch === chId) go("main");
    else emit();
  }

  // ------------------------------------------------------------------
  // Alarms and time
  // ------------------------------------------------------------------
  const ALARMS = {
    air: { msg: "AIR IN LINE", level: "high", fix: "Open door, remove air from the line, reload the set, press RESTART." },
    patientOcc: { msg: "PATIENT SIDE OCCLUSION", level: "high", fix: "Check the IV site and line below the pump, open the slide clamp, press RESTART." },
    fluidOcc: { msg: "FLUID SIDE OCCLUSION", level: "high", fix: "Open the roller clamp above the pump, check the bag and spike, press RESTART." },
    complete: { msg: "INFUSION COMPLETE - KVO", level: "high", fix: "Hang a new bag if ordered. CHANNEL SELECT, enter new VTBI, press START." },
    secComplete: { msg: "SECONDARY COMPLETE", level: "low", fix: "Primary infusion has resumed. Press SILENCE or CHANNEL SELECT." },
    paused: { msg: "CHANNEL PAUSED TOO LONG", level: "low", fix: "Press RESTART to resume, or CHANNEL OFF." },
  };

  function raiseAlarm(ch, type) {
    ch.alarm = Object.assign({ type }, ALARMS[type]);
    if (!["secComplete", "paused", "complete"].includes(type)) ch.state = "alarm";
    S.silencedUntil = 0;
    log("alarm", { ch: ch.id, alarm: type });
  }

  function tick(dtSec) {
    if (!S.on || S.screen.id === "boot") return;
    S.t += dtSec;
    const dth = dtSec / 3600;
    CHANNEL_IDS.forEach((id) => {
      const ch = S.channels[id], b = ch.bedside;
      if (ch.state === "paused" && ch.pausedAt != null && S.t - ch.pausedAt > PAUSE_REMINDER_SEC && !ch.alarm) raiseAlarm(ch, "paused");
      if (ch.state !== "running" && ch.state !== "kvo") return;
      if (!b.clampOpen) return raiseAlarm(ch, "fluidOcc");
      if (b.occluded) return raiseAlarm(ch, "patientOcc");
      if (b.air) return raiseAlarm(ch, "air");

      if (ch.onSecondary && ch.secondary) {
        const sec = ch.secondary;
        const v = Math.min(sec.rate * dth, sec.remaining);
        const secFlows = b.secondaryHung && b.secondaryClampOpen && b.secondaryBag > 0;
        if (secFlows) b.secondaryBag = Math.max(0, b.secondaryBag - v);
        else { b.primaryBag -= v; sec.fromPrimary = (sec.fromPrimary || 0) + v; }
        sec.remaining -= v;
        ch.vi += v;
        if (sec.remaining <= 0.0001) {
          ch.onSecondary = false;
          log("secondaryComplete", { ch: id, fromPrimary: sec.fromPrimary || 0 });
          ch.secondary = null;
          if (sec.callback) raiseAlarm(ch, "secComplete");
        }
      } else if (ch.primary) {
        const p = ch.primary;
        if (ch.state === "kvo") {
          const v = Math.min(KVO_RATE, p.rate) * dth;
          b.primaryBag -= v; ch.vi += v;
        } else {
          const v = Math.min(p.rate * dth, p.remaining);
          p.remaining = Math.max(0, p.remaining - v);
          b.primaryBag -= v; ch.vi += v;
          if (p.remaining <= 0.0001) { ch.state = "kvo"; raiseAlarm(ch, "complete"); log("complete", { ch: id }); }
        }
      }
      if (b.primaryBag <= 0 && b.primed) { b.primaryBag = 0; b.air = true; }
    });
    emit();
  }

  function currentRate(ch) {
    if (ch.state === "kvo") return Math.min(KVO_RATE, ch.primary.rate);
    if (ch.state !== "running") return 0;
    if (ch.onSecondary && ch.secondary) return ch.secondary.rate;
    return ch.primary ? ch.primary.rate : 0;
  }

  // ------------------------------------------------------------------
  // Hardware keys
  // ------------------------------------------------------------------
  function systemOn() {
    if (!S.on) {
      S.on = true;
      S.bootStart = Date.now();
      log("powerOn");
      go("boot");
      bootTimer = setTimeout(() => { if (S.screen.id === "boot") go("newPatient"); }, BOOT_MS);
      return;
    }
    const active = CHANNEL_IDS.some((id) => ["running", "kvo"].includes(S.channels[id].state));
    if (active) { flash("Pause and turn off all channels before powering off", "warn"); emit(); return; }
    clearTimeout(bootTimer);
    S.on = false;
    log("powerOff");
    go("off");
  }

  function key(k) {
    if (!S.on || S.screen.id === "boot") return;
    const sc = S.screen;
    const entryScreen = ["program", "weight", "patientId"].includes(sc.id);
    if (/^[0-9.]$/.test(k)) {
      if (!entryScreen) return;
      if (sc.id === "program" && !sc.draft.field) { flash("Press a soft key (RATE, VTBI, DOSE) first", "warn"); emit(); return; }
      if (k === "." && (S.buffer.includes(".") || sc.id === "patientId" || (sc.draft && sc.draft.field === "duration"))) return;
      if (S.buffer.length >= (sc.id === "patientId" ? 10 : 7)) return;
      S.buffer += k;
      emit();
      return;
    }
    if (k === "CLEAR") {
      if (S.buffer) S.buffer = "";
      else if (sc.id === "program" && sc.draft.field) {
        const d = sc.draft;
        d[d.field] = null;
        if (d.field === "rate" || d.field === "dose") { d.rate = null; d.dose = null; d.duration = null; }
        d.changed = true;
      }
      emit();
      return;
    }
    if (k === "ENTER") { // keyboard convenience only: commits the typed value
      if (sc.id === "program") { commitBuffer(); emit(); }
      else if (sc.id === "weight") weightConfirm();
      else if (sc.id === "patientId") patientIdConfirm();
      return;
    }
    if (k === "SILENCE") {
      S.silencedUntil = Date.now() + 120000;
      log("silence");
      CHANNEL_IDS.forEach((id) => { const ch = S.channels[id]; if (ch.alarm && ch.alarm.type === "secComplete") ch.alarm = null; });
      flash("Audio silenced 2 minutes");
      emit();
      return;
    }
    if (k === "OPTIONS") {
      if (!S.profile || !S.patientId) return;
      go("options");
    }
  }

  function softKey(side, i) {
    if (!S.on || !S.spec) return;
    const arr = side === "L" ? S.spec.left : side === "R" ? S.spec.right : S.spec.bottom;
    const k = arr && arr[i];
    if (k && k.fn && !k.disabled) k.fn();
  }

  function moduleKey(chId, k) {
    if (!S.on || S.screen.id === "boot") return;
    const ch = S.channels[chId];
    if (!S.profile || S.patientId == null) { flash("Finish start-up: profile and patient ID", "warn"); emit(); return; }
    if (k === "SELECT") {
      if (ch.alarm && ch.alarm.type === "secComplete") ch.alarm = null;
      log("select", { ch: chId });
      if (!ch.primary) return go("infusionMenu", { ch: chId });
      return openChannel(chId);
    }
    if (k === "PAUSE") {
      if (ch.state === "running" || ch.state === "kvo") {
        ch.state = "paused"; ch.pausedAt = S.t;
        log("pause", { ch: chId });
        emit();
      }
      return;
    }
    if (k === "RESTART") return restart(chId);
    if (k === "OFF") {
      if (ch.state === "running" || ch.state === "kvo") { flash("Press PAUSE before CHANNEL OFF", "warn"); emit(); return; }
      if (!ch.primary && ch.state === "idle") return;
      go("offConfirm", { ch: chId });
    }
  }

  function channelOff(chId) {
    const b = S.channels[chId].bedside;
    S.channels[chId] = Object.assign(newChannel(chId), { bedside: b });
    log("channelOff", { ch: chId });
    go("main");
  }

  // Opening a running channel shows its program; editing a value and
  // pressing START is how a titration or new VTBI is done.
  function openChannel(chId) {
    const p = S.channels[chId].primary;
    const draft = newDraft(chId, {
      mode: p.mode, drugId: p.drugId, drug: p.drug, conc: p.conc,
      dose: p.dose, rate: p.rate, vtbi: r1(p.remaining), duration: null, titrate: true,
    });
    recalc(draft, "rate");
    go("program", { draft });
  }

  // ------------------------------------------------------------------
  // Selection flow (Infusion Menu → list → concentration → confirm → setup)
  // ------------------------------------------------------------------
  function pickDrug(ctx, drug) {
    log("drugPicked", { ch: ctx.ch, drugId: drug.id });
    if (drug.concs.length > 1) return go("conc", Object.assign({}, ctx, { drug }));
    go("drugConfirm", Object.assign({}, ctx, { drug, conc: drug.concs[0] }));
  }

  function confirmDrug(ctx) {
    log("drugSelected", { ch: ctx.ch, drugId: ctx.drug.id, conc: concLabel(ctx.drug, ctx.conc), secondary: !!ctx.secondary });
    if (ctx.drug.highAlert) return go("advisory", ctx);
    toSetupOrProgram(ctx);
  }

  function toSetupOrProgram(ctx) {
    if (ctx.drug.dose) return go("setup", ctx);
    const draft = newDraft(ctx.ch, { drugId: ctx.drug.id, drug: ctx.drug, conc: ctx.conc, secondary: !!ctx.secondary });
    if (ctx.secondary && ctx.conc.vol) { draft.vtbi = ctx.conc.vol; draft.durMode = true; draft.field = "duration"; }
    else draft.field = "rate";
    go("program", { draft });
  }

  function setupNext(ctx) {
    if (ctx.drug.dose.perKg && !S.weight) { flash("Enter patient weight", "warn"); emit(); return; }
    const draft = newDraft(ctx.ch, { drugId: ctx.drug.id, drug: ctx.drug, conc: ctx.conc, secondary: !!ctx.secondary });
    if (ctx.secondary) draft.vtbi = ctx.conc.vol;
    draft.field = "dose";
    go("program", { draft });
  }

  function basicInfusion(chId, secondary) {
    log("basicSelected", { ch: chId, secondary: !!secondary });
    const draft = newDraft(chId, { mode: "basic", secondary: !!secondary });
    draft.field = "rate";
    go("program", { draft });
  }

  function weightConfirm() {
    const v = parseFloat(S.buffer);
    if (S.buffer === "" && S.weight) return go(S.screen.back.id, S.screen.back);
    if (isNaN(v) || v < 0.3 || v > 500) { flash("Weight must be 0.3 - 500 kg", "warn"); S.buffer = ""; emit(); return; }
    S.weight = v;
    log("weight", { kg: v });
    go(S.screen.back.id, S.screen.back);
  }

  function patientIdConfirm() {
    if (!S.buffer) { flash("Enter the patient ID with the keypad", "warn"); emit(); return; }
    S.patientId = S.buffer;
    log("patientId", { id: S.buffer });
    go("main");
  }

  // ------------------------------------------------------------------
  // Screen specs
  //   { badge, title, sub, rows[5], text, left[5], right[5], bottom[4], prompt, alert }
  // ------------------------------------------------------------------
  const K = (label, fn, extra) => Object.assign({ label, fn }, extra);
  const blank5 = () => [null, null, null, null, null];

  function spec() {
    const sc = S.screen;
    const prof = S.profile ? PROFILES[S.profile].name : "";
    const base = { badge: null, title: HOSPITAL, sub: prof, rows: null, text: "", left: blank5(), right: blank5(), bottom: [null, null, null, null], prompt: "", alert: null };
    switch (sc.id) {
      case "off": return Object.assign(base, { off: true });
      case "boot": return Object.assign(base, { boot: true });

      case "newPatient":
        return Object.assign(base, {
          title: HOSPITAL, sub: "System Start",
          text: `<div class="c-mid"><div class="c-big">New Patient?</div><div class="c-small">Yes clears the previous patient's profile, ID and weight.</div></div>`,
          right: [K("Yes", () => { S.weight = null; S.patientId = null; log("newPatient", { yes: true }); go("profile"); }), K("No", () => { log("newPatient", { yes: false }); S.profile ? go(S.patientId ? "main" : "patientId") : go("profile"); }), null, null, null],
          prompt: ">Press Yes or No",
        });

      case "profile": {
        const ids = Object.keys(PROFILES);
        return Object.assign(base, {
          sub: "Select Profile",
          left: ids.map((id) => K(PROFILES[id].name, () => go("profileConfirm", { pid: id }))).concat([null]).slice(0, 5),
          prompt: ">Select Profile (care area)",
        });
      }
      case "profileConfirm":
        return Object.assign(base, {
          sub: "Confirm Profile",
          text: `<div class="c-mid"><div class="c-small">Profile:</div><div class="c-big">${PROFILES[sc.pid].name}</div><div>Is this correct?</div></div>`,
          right: [K("Yes", () => { S.profile = sc.pid; log("profile", { profile: sc.pid }); go("patientId"); }), K("No", () => go("profile")), null, null, null],
          prompt: ">Press Yes or No",
        });

      case "patientId":
        return Object.assign(base, {
          sub: "Patient ID Entry",
          text: `<div class="c-mid"><div>Patient ID:</div><div class="c-entry">${S.buffer || "_ _ _ _ _ _"}<span class="cursor"></span></div><div class="c-small">Use the number keys. Enter the patient's ID (MRN) from the armband.</div></div>`,
          bottom: [null, null, null, K("CONFIRM", patientIdConfirm)],
          prompt: ">Enter Patient ID",
        });

      case "main": {
        const rows = CHANNEL_IDS.map((id) => {
          const ch = S.channels[id];
          if (!ch.primary) return `<span class="c-ch">${id}</span> <span class="c-dim">Available</span>`;
          const p = ch.onSecondary && ch.secondary ? ch.secondary : ch.primary;
          const g = p.overrides && p.overrides.length ? ` <span class="c-g">G</span>` : "";
          const dose = hasDose(p) ? ` ${fmtNum(p.dose, 2)} ${doseUnit(p)}` : "";
          return `<div><span class="c-ch">${id}</span> <b>${ch.onSecondary ? "SEC " : ""}${drugLabel(p)}</b>${g}<br><span class="c-small">${stateLabel(ch)} · ${fmtNum(currentRate(ch) || p.rate, 1)} mL/h${dose} · VTBI = ${fmtNum(p.remaining, 1)} mL</span></div>`;
        });
        return Object.assign(base, {
          rows: [`<span class="c-small">Patient ID: <b>${S.patientId}</b>${S.weight ? ` · ${fmtNum(S.weight, 1)} kg` : ""}</span>`, rows[0], rows[1], "", ""],
          bottom: [K("VOLUME INFUSED", () => go("options")), null, null, null],
          prompt: CHANNEL_IDS.some((id) => S.channels[id].primary) ? "" : ">Press CHANNEL SELECT on a module",
        });
      }

      case "infusionMenu":
        return Object.assign(base, {
          badge: sc.ch, title: "Infusion Menu", sub: "",
          left: [
            K("Guardrails Drugs", () => go("list", { ch: sc.ch, kind: "drugs", page: 0 })),
            K("Guardrails IV Fluids", () => go("list", { ch: sc.ch, kind: "fluids", page: 0 })),
            K("No Guardrails-Basic Infusion", () => basicInfusion(sc.ch)),
            null, null],
          bottom: [null, K("EXIT", () => go("main")), null, null],
          prompt: ">Select an Option or EXIT",
        });

      case "list": {
        const all = listFor(sc.kind);
        const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
        const page = Math.min(sc.page, pages - 1);
        const items = all.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
        const left = blank5();
        items.forEach((d, i) => { left[i] = K(d.name, () => pickDrug(sc, d)); });
        const right = LETTER_GROUPS.map(([a, z]) => K(`${a}-${z}`, () => {
          const idx = all.findIndex((d) => { const c = d.name[0].toUpperCase(); return c >= a && c <= z; });
          if (idx < 0) { flash(`No entries ${a}-${z}`, "warn"); emit(); return; }
          go("list", Object.assign({}, sc, { page: Math.floor(idx / PER_PAGE) }));
        }, { small: true }));
        const title = sc.kind === "fluids" ? "Guardrails IV Fluids" : "Guardrails Drugs";
        return Object.assign(base, {
          badge: sc.ch, title: sc.secondary ? `${title} · SECONDARY` : title, sub: prof,
          left, right,
          bottom: [
            sc.secondary ? K("PRIMARY", () => openChannel(sc.ch)) : K("EXIT", () => go("infusionMenu", { ch: sc.ch })),
            sc.secondary ? K("BASIC SEC", () => basicInfusion(sc.ch, true)) : null,
            page > 0 ? K("PAGE UP", () => go("list", Object.assign({}, sc, { page: page - 1 }))) : null,
            page < pages - 1 ? K("PAGE DOWN", () => go("list", Object.assign({}, sc, { page: page + 1 }))) : null,
          ],
          prompt: sc.kind === "fluids" ? ">Select IV Fluid" : ">Select Drug",
        });
      }

      case "conc": {
        const left = blank5();
        sc.drug.concs.forEach((c, i) => { left[i] = K(concLabel(sc.drug, c).replace(/ \/ /g, "/"), () => go("drugConfirm", Object.assign({}, sc, { conc: c }))); });
        return Object.assign(base, {
          badge: sc.ch, title: sc.drug.name, sub: prof, left,
          bottom: [K("EXIT", () => go("list", sc)), null, null, null],
          prompt: ">Select Concentration",
        });
      }

      case "drugConfirm":
        return Object.assign(base, {
          badge: sc.ch, title: sc.secondary ? "Guardrails Drug Setup · SECONDARY" : "Guardrails Drug Setup", sub: prof,
          text: `<div class="c-block"><div class="c-big">${sc.drug.name}</div><div>${concLabel(sc.drug, sc.conc)} was selected.</div><div style="margin-top:8px">Is this correct?</div></div>`,
          right: [K("Yes", () => confirmDrug(sc)), K("No", () => go("list", sc)), null, null, null],
          prompt: ">Press Yes or No",
        });

      case "advisory":
        return Object.assign(base, {
          badge: sc.ch, title: sc.drug.name, sub: "Clinical Advisory",
          text: `<div class="c-block"><div class="c-big">Clinical Advisory:</div><div>HIGH ALERT medication. Independent double check required before START.</div>${sc.drug.note ? `<div class="c-small" style="margin-top:6px">${sc.drug.note}</div>` : ""}</div>`,
          bottom: [null, null, null, K("CONFIRM", () => toSetupOrProgram(sc))],
          prompt: ">Press CONFIRM",
        });

      case "setup": {
        const d = sc.drug, perKg = d.dose.perKg;
        const wt = perKg ? (S.weight ? `${fmtNum(S.weight, 1)} kg` : "_ _ _ _ kg") : "Not Used";
        return Object.assign(base, {
          badge: sc.ch, title: "Guardrails Drug Setup", sub: d.name,
          rows: [
            `<span class="c-val">${fmtNum(sc.conc.amt, 3)} ${sc.conc.unit}</span>`,
            `<span class="c-val">${fmtNum(sc.conc.vol)} mL</span>`,
            `[Conc]: ${concPerMlLabel(sc.conc)}`,
            `<span class="c-lbl">DOSING UNITS</span> ${doseUnit({ drug: d })}`,
            `<span class="c-val">${wt}</span>`,
          ],
          left: [K("DRUG AMOUNT", null, { box: true, inert: true }), K("DILUENT VOLUME", null, { box: true, inert: true }), null, null,
            perKg ? K("PATIENT WEIGHT", () => go("weight", { back: sc }), { box: true }) : K("PATIENT WEIGHT", null, { box: true, inert: true })],
          bottom: [K("EXIT", () => go("list", sc)), null, null, K("NEXT", () => setupNext(sc), { disabled: perKg && !S.weight })],
          prompt: perKg && !S.weight ? ">Enter Patient Weight" : ">Press NEXT to Confirm",
        });
      }

      case "weight":
        return Object.assign(base, {
          badge: sc.back.ch, title: "Guardrails Drug Setup", sub: "Patient Weight",
          text: `<div class="c-mid"><div>PATIENT WEIGHT</div><div class="c-entry">${S.buffer || (S.weight ? fmtNum(S.weight, 1) : "_ _ _ _")}<span class="cursor"></span> kg</div><div class="c-small">Use the weight in the order or chart.</div></div>`,
          bottom: [K("EXIT", () => go(sc.back.id, sc.back)), null, null, K("CONFIRM", weightConfirm)],
          prompt: ">Enter Patient Weight",
        });

      case "program": return programSpec(base, sc.draft);

      case "limit": {
        const { lim, draft } = sc;
        const verb = lim.dir === "max" ? "exceeds" : "is below";
        if (lim.kind === "hard") {
          return Object.assign(base, {
            badge: draft.ch, title: draft.drug.name, sub: prof, alert: "hard",
            text: `<div class="c-block c-alert"><b>${lim.what} of ${fmtNum(lim.val, 3)} ${lim.unit} ${verb} Guardrails hard limit of ${fmtNum(lim.limit, 3)} ${lim.unit}.</b><div class="c-small" style="margin-top:8px">Hard limits cannot be overridden. Hold the infusion and clarify the order.</div></div>`,
            right: [K("Reprogram", () => { const f = hasDose(draft) ? "dose" : "rate"; draft.rate = null; draft.dose = null; draft.duration = null; draft.durMode = false; draft.field = f; go("program", { draft }); }), null, null, null, null],
            prompt: ">Press REPROGRAM",
          });
        }
        return Object.assign(base, {
          badge: draft.ch, title: draft.drug.name, sub: prof, alert: "soft",
          text: `<div class="c-block c-alert"><b>${lim.what} of ${fmtNum(lim.val, 3)} ${lim.unit} ${verb} Guardrails limit of ${fmtNum(lim.limit, 3)} ${lim.unit}. Proceed?</b><div class="c-small" style="margin-top:8px">Override only after verifying the order.</div></div>`,
          right: [
            K("Yes", () => { draft.overrides.push({ dir: lim.dir, val: lim.val, limit: lim.limit }); log("override", { ch: draft.ch, drugId: draft.drugId, val: lim.val, limit: lim.limit, dir: lim.dir }); go("program", { draft }); pressStart(); }),
            K("No", () => { log("softReenter", { ch: draft.ch }); draft.field = hasDose(draft) ? "dose" : "rate"; go("program", { draft }); }),
            null, null, null],
          prompt: ">Press Yes or No",
        });
      }

      case "offConfirm":
        return Object.assign(base, {
          badge: sc.ch, title: "Channel Off", sub: "",
          text: `<div class="c-mid"><div class="c-big">Turn off Channel ${sc.ch}?</div><div class="c-small">Program and volume infused for this channel will be cleared.</div></div>`,
          right: [K("Yes", () => channelOff(sc.ch)), K("No", () => go("main")), null, null, null],
          prompt: ">Press Yes or No",
        });

      case "options":
        return Object.assign(base, {
          sub: "Volume Infused",
          rows: CHANNEL_IDS.map((id) => `<span class="c-ch">${id}</span> ${fmtNum(S.channels[id].vi, 1)} mL`).concat(["", "", ""]).slice(0, 5),
          bottom: [K("MAIN SCREEN", () => go("main")), null, null, K("CLEAR VOLUMES", () => { CHANNEL_IDS.forEach((id) => (S.channels[id].vi = 0)); log("clearVolume"); emit(); })],
          prompt: ">Document on I&O, then CLEAR",
        });
    }
    return base;
  }

  function programSpec(base, d) {
    const ch = S.channels[d.ch];
    const val = (f, v, unit, digits) => {
      const active = d.field === f;
      let shown;
      if (active && S.buffer !== "") shown = f === "duration" ? durFromBuffer(S.buffer) : S.buffer;
      else if (v == null) shown = f === "duration" ? "_ _:_ _" : "_ _ _";
      else shown = f === "duration" ? fmtDur(v) : fmtNum(v, digits);
      return `<span class="c-val${active ? " on" : ""}">${shown}${active ? '<span class="cursor"></span>' : ""}</span> <span class="c-unit">${unit}</span>`;
    };
    const fk = (f, label) => K(label, () => selectField(f), { box: true, active: d.field === f });
    let heading = d.secondary ? "SECONDARY" : hasDose(d) ? "CONTINUOUS INFUSION" : "PRIMARY INFUSION";
    const rows = [heading, "", "", "", ""];
    const left = blank5();
    left[1] = fk("rate", "RATE"); rows[1] = val("rate", d.rate, "mL/h", 2);
    left[2] = fk("vtbi", "VTBI"); rows[2] = val("vtbi", d.vtbi, "mL", 2);
    if (hasDose(d)) { left[3] = fk("dose", "DOSE"); rows[3] = val("dose", d.dose, doseUnit(d), 3); }
    const durRow = hasDose(d) ? 4 : 3;
    if (d.durMode || !hasDose(d)) {
      if (d.durMode) { left[durRow] = fk("duration", "DURATION"); rows[durRow] = val("duration", d.duration, "h:mm"); }
      else if (d.duration) rows[durRow] = `<span class="c-small">Duration ${fmtDur(d.duration)}</span>`;
    }
    if (d.conc && d.conc.amt) rows[4] = (rows[4] ? rows[4] + " · " : "") + `<span class="c-small">[Conc]: ${concPerMlLabel(d.conc)}${d.drug.dose && d.drug.dose.perKg ? ` · ${fmtNum(S.weight, 1)} kg` : ""}</span>`;
    if (d.mode === "basic") rows[4] = `<span class="c-warn">No Guardrails limits</span>`;

    let prompt = ">Select Rate or Dose";
    if (d.field === "vtbi") prompt = ">Enter VTBI";
    else if (d.field === "duration") prompt = ">Enter Duration (hhmm)";
    else if (d.field === "rate") prompt = ">Enter Rate";
    else if (d.field === "dose") prompt = ">Enter Dose";
    const ready = !validate(d);
    if (ready && S.buffer === "") prompt = d.secondary ? ">Verify Secondary Clamp Open, Then Press START" : ">Press START";
    if (ch.alarm && d.titrate) prompt = `>${ch.alarm.msg}`;

    const bottom = [null, null, null, K("START", pressStart)];
    if (d.titrate) {
      bottom[0] = !ch.onSecondary && ch.state !== "kvo" ? K("SECONDARY", () => { commitBuffer(); go("list", { ch: d.ch, kind: "drugs", page: 0, secondary: true }); }) : null;
      bottom[1] = K("PAUSE", () => moduleKey(d.ch, "PAUSE"));
      bottom[2] = K("MAIN", () => go("main"));
    } else if (d.secondary) {
      bottom[0] = K(`CALLBACK ${d.callback ? "ON" : "OFF"}`, () => { d.callback = !d.callback; emit(); });
      bottom[1] = K("EXIT", () => openChannel(d.ch));
    } else {
      bottom[0] = K("EXIT", () => { log("cancelProgram", { ch: d.ch }); go("infusionMenu", { ch: d.ch }); });
      if (!hasDose(d)) bottom[1] = K(d.durMode ? "RATE VOLUME" : "VOLUME DURATION", () => { commitBuffer(); d.durMode = !d.durMode; d.field = d.durMode ? (d.vtbi ? "duration" : "vtbi") : "rate"; emit(); });
    }
    if (hasDose(d) && d.drug.dose.perKg && !d.titrate) left[4] = K("WEIGHT", () => { commitBuffer(); go("weight", { back: { id: "program", draft: d, ch: d.ch } }); }, { box: true });
    if (!hasDose(d) && d.secondary) bottom[2] = K(d.durMode ? "RATE VOLUME" : "VOLUME DURATION", () => { commitBuffer(); d.durMode = !d.durMode; d.field = d.durMode ? (d.vtbi ? "duration" : "vtbi") : "rate"; emit(); });
    const title = d.mode === "basic" ? "Basic Infusion" : d.drug.name;
    const g = ch.primary && ch.primary.overrides.length && d.titrate ? " G" : "";
    return Object.assign(base, {
      badge: d.ch, title: title + g, sub: d.mode === "basic" ? "No Guardrails" : d.conc ? concLabel(d.drug, d.conc) : "",
      rows, left, bottom, prompt,
    });
  }

  function durFromBuffer(buf) {
    const m = parseDuration(buf);
    return isNaN(m) ? buf : fmtDur(m);
  }

  function stateLabel(ch) {
    if (ch.alarm && ch.state === "alarm") return "ALARM";
    return { idle: "Available", running: ch.onSecondary ? "SECONDARY" : "INFUSING", paused: "PAUSED", alarm: "ALARM", kvo: "KVO" }[ch.state];
  }

  function fmtDur(min) {
    if (!min && min !== 0) return "—";
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  // ------------------------------------------------------------------
  // Bedside actions
  // ------------------------------------------------------------------
  function bedside(chId, action, arg) {
    const ch = S.channels[chId], b = ch.bedside;
    switch (action) {
      case "prime":
        b.primed = true; b.air = false;
        // Bags carry manufacturer overfill, so a VTBI equal to the labeled volume finishes before the bag runs dry.
        if (arg) { b.primaryBag = arg.vol + 10; b.primaryBagName = arg.name; }
        else if (!b.primaryBag) { b.primaryBag = 1010; b.primaryBagName = "Primary bag"; }
        break;
      case "load": b.loaded = true; break;
      case "unload":
        if (ch.state === "running" || ch.state === "kvo") { flash("Pause the channel before opening the door", "warn"); emit(); return; }
        b.loaded = false; break;
      case "trace": b.traced = true; break;
      case "clamp": b.clampOpen = !b.clampOpen; break;
      case "fixOcclusion": b.occluded = false; break;
      case "clearAir":
        if (ch.state === "running") { flash("Pause the channel before opening the door", "warn"); emit(); return; }
        b.air = false; b.primed = true; break;
      case "hangSecondary":
        b.secondaryHung = true;
        b.secondaryBag = arg ? arg.vol : 100;
        b.secondaryBagName = arg ? arg.name : "Secondary bag";
        break;
      case "secClamp": b.secondaryClampOpen = !b.secondaryClampOpen; break;
    }
    log("bedside", { ch: chId, action, clampOpen: b.clampOpen });
    emit();
  }

  function render() {
    if (S.flash && Date.now() > S.flash.until) S.flash = null;
    S.spec = spec();
    return S.spec;
  }

  // Direct setup used by scenarios that start mid-shift.
  function preset(cfg) {
    reset();
    S.on = true;
    S.profile = cfg.profile;
    S.weight = cfg.weight || null;
    S.patientId = cfg.patientId || "000000";
    (cfg.channels || []).forEach((c) => {
      const ch = S.channels[c.ch];
      Object.assign(ch.bedside, { primed: true, loaded: true, traced: true, clampOpen: true, primaryBag: c.bag || 1000, primaryBagName: c.bagName || "" }, c.bedside || {});
      if (c.drugId) {
        const drug = profileDrug(cfg.profile, c.drugId);
        const conc = drug.concs[c.concIdx || 0];
        let rate = c.rate, dose = c.dose;
        if (dose != null && drug.dose) rate = r1(doseToRate(drug, conc, dose, S.weight));
        if (rate != null && dose == null && drug.dose) dose = r2(rateToDose(drug, conc, rate, S.weight));
        ch.primary = { mode: "guardrails", drugId: c.drugId, drug, conc, dose, rate, vtbi: c.vtbi, remaining: c.remaining != null ? c.remaining : c.vtbi, duration: Math.round((c.vtbi / rate) * 60), overrides: [], weight: S.weight };
        ch.state = c.state || "running";
        if (ch.state === "paused") ch.pausedAt = 0;
      }
    });
    S.screen = { id: "main" };
    // A new practice order starts at New Patient? -> profile -> patient ID.
    if (cfg.fresh) { S.profile = null; S.patientId = null; S.weight = null; S.screen = { id: "newPatient" }; }
    emit();
  }

  reset();

  return {
    get state() { return S; },
    reset, preset, tick, render, onChange, emit,
    systemOn, key, softKey, moduleKey, bedside, flash,
    currentRate, stateLabel, drugLabel, hasDose, doseUnit, logHas, log,
  };
})();
