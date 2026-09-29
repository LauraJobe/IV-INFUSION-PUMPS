/*
 * Practice mode: endless random orders for programming practice only.
 * Tubing, clamps and loading are already done. Patients, doses and rates
 * are generated and deliberately different from the simulation scenarios.
 */

const PRACTICE = (() => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;

  const SPECIALTIES = {
    all: "All specialties",
    medsurg: "Med-Surg",
    icu: "ICU / PCU",
    ld: "Labor & Delivery",
    peds: "Pediatrics",
  };

  const FIRST = ["Avery", "Marcus", "Delia", "Tomás", "Priya", "Grace", "Harold", "Imani", "Keith", "Lorena", "Nadia", "Owen", "Rosa", "Samuel", "Tanya", "Victor", "Wendell", "Yolanda", "Beatrice", "Curtis", "Esther", "Frank", "Gloria", "Hector", "June", "Leon", "Mabel", "Norris", "Opal", "Reggie"];
  const LAST = ["Abernathy", "Blackwell", "Castillo", "Dunmore", "Ellison", "Fairbanks", "Garrison", "Holloway", "Iverson", "Jennings", "Kowalski", "Lindqvist", "Montoya", "Nakamura", "Okafor", "Pruitt", "Quintero", "Ramsey", "Stroud", "Takahashi", "Underwood", "Vasquez", "Whitfield", "Yates", "Zeller", "Beaumont", "Carver", "Dalton", "Everly", "Fontaine"];
  const KID_FIRST = ["Ella", "Mason", "Aria", "Jayden", "Lily", "Caleb", "Nora", "Eli", "Maya", "Wyatt", "Zoe", "Levi"];

  // Values reserved for other course activities are skipped. Stored as
  // hashes so the list itself does not reveal them.
  const hash = (str) => { let x = 5381; for (const ch of str) x = ((x * 33) ^ ch.charCodeAt(0)) >>> 0; return x.toString(36); };
  const EXCLUDE = new Set(["2zo4oz", "nx3sif", "13ordr0", "117mdw2", "5j5p2w", "5j5p32", "1wo48hm", "1jw4abm", "hwgyzj", "hwh4ho", "1mda3oo", "7c3vq3", "7c3vow", "h7a11", "h7a0z", "ro08us", "ii3qyp", "16cja39", "16jr6ou", "aen5ad", "lu8h2o", "16ldk9w"]);
  const excluded = (key) => EXCLUDE.has(hash(key));

  function patient(spec) {
    if (spec === "peds") {
      const w = randInt(5, 28);
      const age = w < 10 ? `${randInt(6, 18)} months` : `${Math.max(2, Math.round((w - 8) / 2))} y`;
      return { name: `${pick(KID_FIRST)} ${pick(LAST)}`, age, weight: w };
    }
    if (spec === "ld") return { name: `${pick(["Grace", "Imani", "Lorena", "Nadia", "Rosa", "Tanya", "Esther", "June", "Priya", "Delia"])} ${pick(LAST)}`, age: `${randInt(19, 39)} y`, weight: randInt(60, 98) };
    return { name: `${pick(FIRST)} ${pick(LAST)}`, age: `${randInt(24, 88)} y`, weight: randInt(48, 118) };
  }

  const UNIT = { medsurg: "Med-Surg", icu: "ICU", ld: "Labor & Delivery", peds: "Pediatrics" };

  function concText(d, c) {
    if (!c.amt) return `${fmtNum(c.vol)} mL`;
    return `${fmtNum(c.amt, 3)} ${c.unit} in ${fmtNum(c.vol)} mL`;
  }
  const durText = (min) => (min % 60 === 0 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);

  // ---------------------------------------------------------------- builders
  // Each returns an order object or null (null = try again).

  // True when a value sits inside the drug's soft limits (no alert expected).
  function inSoft(d, v) {
    const l = d.limits;
    return !(l.softMax != null && v > l.softMax) && !(l.softMin != null && v < l.softMin);
  }

  function continuous(spec, drugId, doses, opts = {}) {
    const d = profileDrug(spec, drugId);
    const ci = opts.concIdx != null ? opts.concIdx : randInt(0, d.concs.length - 1);
    const c = d.concs[ci];
    const dose = pick(doses);
    const p = patient(spec);
    const rate = r1(doseToRate(d, c, dose, p.weight));
    if (rate < 0.5 || rate > 500) return null;
    if (!opts.hold && !inSoft(d, dose)) return null;
    const unit = doseUnitLabel(d);
    return {
      spec, kind: opts.hold ? "hold" : "primary", drugId, concIdx: ci, dose, rate, vtbi: c.vol, patient: p,
      perKg: d.dose.perKg,
      text: `<b>${d.name} ${concText(d, c)}</b>. ${opts.verb || "Start at"} <b>${fmtNum(dose, 3)} ${unit}</b>${opts.tail || ""}.`,
      math: `${fmtNum(dose, 3)} ${unit}${d.dose.perKg ? ` × ${p.weight} kg` : ""}${d.dose.time === "min" ? " × 60 min" : ""} ÷ ${concPerMlLabel(c)} = <b>${fmtNum(rate, 1)} mL/h</b>. VTBI = ${fmtNum(c.vol)} mL.`,
      steps: [`CHANNEL SELECT → Guardrails Drugs → ${d.name}${d.concs.length > 1 ? ` → ${concLabel(d, c)}` : ""} → Yes${d.highAlert ? " → CONFIRM" : ""}`,
        d.dose.perKg ? `PATIENT WEIGHT ${p.weight} → CONFIRM → NEXT` : "NEXT", `DOSE ${fmtNum(dose, 3)} → VTBI ${fmtNum(c.vol)} → START`],
    };
  }

  function fluid(spec, drugId, rates, opts = {}) {
    const d = profileDrug(spec, drugId);
    const ci = randInt(0, d.concs.length - 1);
    const c = d.concs[ci];
    const rate = pick(rates);
    if (!inSoft(d, rate)) return null;
    const p = patient(spec);
    return {
      spec, kind: "primary", drugId, concIdx: ci, rate, vtbi: c.vol, patient: p,
      text: `<b>${d.name}</b> IV at <b>${rate} mL/hr</b>. Bag on hand: ${fmtNum(c.vol)} mL.`,
      math: `Rate-based fluid: RATE ${rate} mL/h, VTBI ${fmtNum(c.vol)} mL (the bag volume).`,
      steps: [`CHANNEL SELECT → Guardrails IV Fluids → ${d.name}${d.concs.length > 1 ? ` → ${fmtNum(c.vol)} mL` : ""} → Yes`, `RATE ${rate} → VTBI ${fmtNum(c.vol)} → START`],
    };
  }

  function secondary(spec, drugId, minutesList, primaryFluid, primaryRates) {
    const d = profileDrug(spec, drugId);
    const ci = randInt(0, d.concs.length - 1);
    const c = d.concs[ci];
    const min = pick(minutesList);
    const rate = r1(c.vol / (min / 60));
    if (!inSoft(d, rate)) return null;
    const p = patient(spec);
    const pf = profileDrug(spec, primaryFluid);
    const pr = pick(primaryRates);
    return {
      spec, kind: "secondary", drugId, concIdx: ci, rate, vtbi: c.vol, patient: p, minutes: min,
      primary: { drugId: primaryFluid, rate: pr },
      text: `<b>${d.name} ${fmtNum(c.amt, 3)} ${c.unit}</b> IVPB in ${fmtNum(c.vol)} mL, infuse over <b>${durText(min)}</b>.<br><span class="policy">${pf.name} is running on Channel A at ${pr} mL/hr. The secondary bag is hung above the primary with its clamp open.</span>`,
      math: `${fmtNum(c.vol)} mL ÷ ${r2(min / 60)} h = <b>${fmtNum(rate, 1)} mL/h</b>. VTBI = ${fmtNum(c.vol)} mL. (Or type DURATION ${min >= 60 ? `${Math.floor(min / 60)}${String(min % 60).padStart(2, "0")}` : min}.)`,
      steps: [`CHANNEL SELECT on A → SECONDARY → ${d.name}${d.concs.length > 1 ? ` → ${concLabel(d, c)}` : ""} → Yes`, `VTBI is pre-filled (${fmtNum(c.vol)}). DURATION ${min >= 60 ? `${Math.floor(min / 60)}${String(min % 60).padStart(2, "0")}` : min} (${durText(min)}) → START`],
    };
  }

  function titrate(spec, drugId, fromDoses, step, opts = {}) {
    const d = profileDrug(spec, drugId);
    const ci = randInt(0, d.concs.length - 1);
    const c = d.concs[ci];
    const from = pick(fromDoses);
    const to = r2(from + step * (opts.down ? -1 : 1) * pick(opts.multipliers || [1]));
    if (to <= 0) return null;
    const p = patient(spec);
    const rate = r1(doseToRate(d, c, to, p.weight));
    const unit = doseUnitLabel(d);
    return {
      spec, kind: "titrate", drugId, concIdx: ci, fromDose: from, dose: to, rate, patient: p, perKg: d.dose.perKg,
      text: `<b>${d.name} ${concText(d, c)}</b> is running on Channel A at ${fmtNum(from, 3)} ${unit}.<br>${opts.reason || "New order:"} <b>${to > from ? "Increase" : "Decrease"} to ${fmtNum(to, 3)} ${unit}</b>.`,
      math: `${fmtNum(to, 3)} ${unit}${d.dose.perKg ? ` × ${p.weight} kg` : ""}${d.dose.time === "min" ? " × 60" : ""} ÷ ${concPerMlLabel(c)} = <b>${fmtNum(rate, 1)} mL/h</b>. Change the DOSE, not the rate.`,
      steps: ["CHANNEL SELECT on A", `DOSE ${fmtNum(to, 3)} → START`],
    };
  }

  function pedsBolus() {
    for (let i = 0; i < 20; i++) {
      const p = patient("peds");
      const perKg = pick([10, 20]);
      const min = pick([30, 60]);
      const vtbi = perKg * p.weight;
      const rate = r1(vtbi / (min / 60));
      if (rate > 300 || vtbi > 500) continue;
      const bag = vtbi <= 240 ? 250 : 500;
      const ci = profileDrug("peds", "nsBolus").concs.findIndex((c) => c.vol === bag);
      return {
        spec: "peds", kind: "primary", drugId: "nsBolus", concIdx: ci, rate, vtbi, patient: p,
        text: `<b>0.9% Sodium Chloride bolus ${perKg} mL/kg</b> IV over <b>${durText(min)}</b>. Bag on hand: ${bag} mL.`,
        math: `${perKg} mL/kg × ${p.weight} kg = <b>${vtbi} mL</b> (VTBI, not the bag volume). ${vtbi} mL ÷ ${min / 60} h = <b>${fmtNum(rate, 1)} mL/h</b>.`,
        steps: [`CHANNEL SELECT → Guardrails IV Fluids → Sodium Chloride 0.9% BOLUS → ${bag} mL → Yes`, `VOLUME DURATION → VTBI ${vtbi} → DURATION ${min === 60 ? "100" : min} → START`],
      };
    }
    return null;
  }

  function pedsMaintenance() {
    const p = patient("peds");
    const w = p.weight;
    const rate = w <= 10 ? 4 * w : w <= 20 ? 40 + 2 * (w - 10) : 60 + (w - 20);
    const drugId = pick(["d5halfns", "d5ns"]);
    const d = profileDrug("peds", drugId);
    return {
      spec: "peds", kind: "primary", drugId, concIdx: 0, rate, vtbi: 1000, patient: p,
      text: `<b>${d.name}</b> IV at <b>${rate} mL/hr</b> (maintenance). Bag on hand: 1000 mL.`,
      math: `RATE ${rate} mL/h, VTBI 1000 mL. (${rate} mL/h is the 4-2-1 maintenance rate for ${w} kg.)`,
      steps: [`CHANNEL SELECT → Guardrails IV Fluids → ${d.name} → Yes`, `RATE ${rate} → VTBI 1000 → START`],
    };
  }

  function pedsBlood() {
    for (let i = 0; i < 20; i++) {
      const p = patient("peds");
      const vtbi = 10 * p.weight;
      const hrs = pick([3, 4]);
      const rate = r1(vtbi / hrs);
      if (vtbi > 300 || rate > 175) continue;
      return {
        spec: "peds", kind: "primary", drugId: "prbc", concIdx: 0, rate, vtbi, patient: p,
        text: `<b>Packed red blood cells 10 mL/kg</b> IV over <b>${hrs} hours</b>. Unit volume 300 mL.`,
        math: `10 mL/kg × ${p.weight} kg = <b>${vtbi} mL</b> VTBI. ${vtbi} ÷ ${hrs} h = <b>${fmtNum(rate, 1)} mL/h</b>.`,
        steps: ["CHANNEL SELECT → Guardrails IV Fluids → Packed Red Blood Cells → 300 mL → Yes", `RATE ${fmtNum(rate, 1)} → VTBI ${vtbi} → START`],
      };
    }
    return null;
  }

  function magOB() {
    const dose = pick([1, 1.5, 2, 2.5, 3]);
    const o = continuous("ld", "magnesiumOB", [dose]);
    o.text = `<b>Magnesium sulfate 40 g in 1000 mL</b> maintenance at <b>${dose} g/hr</b>.`;
    return o;
  }

  function magIntermittent() {
    const hrs = pick([2, 4]);
    const d = profileDrug("medsurg", "magnesium");
    const dose = r2(2 / hrs);
    const p = patient("medsurg");
    const rate = r1(doseToRate(d, d.concs[0], dose, p.weight));
    return {
      spec: "medsurg", kind: "primary", drugId: "magnesium", concIdx: 0, dose, rate, vtbi: 50, patient: p,
      text: `<b>Magnesium sulfate 2 g in 50 mL</b> IV over <b>${hrs} hours</b>.`,
      math: `2 g ÷ ${hrs} h = <b>${dose} g/hr</b> DOSE → ${fmtNum(rate, 1)} mL/h. VTBI 50 mL.`,
      steps: ["CHANNEL SELECT → Guardrails Drugs → Magnesium Sulfate → Yes → CONFIRM → NEXT", `DOSE ${dose} → VTBI 50 → START`],
    };
  }

  function kclRider() {
    const d = profileDrug("medsurg", "kcl");
    const ci = pick([0, 1]);
    const c = d.concs[ci];
    const hrs = c.amt === 10 ? pick([1, 2]) : 2;
    const dose = r2(c.amt / hrs);
    const p = patient("medsurg");
    const rate = r1(doseToRate(d, c, dose, p.weight));
    return {
      spec: "medsurg", kind: "primary", drugId: "kcl", concIdx: ci, dose, rate, vtbi: c.vol, patient: p,
      text: `<b>Potassium chloride ${c.amt} mEq in ${c.vol} mL</b> IV over <b>${hrs} hour${hrs > 1 ? "s" : ""}</b> via peripheral IV. Run on its own channel.`,
      math: `${c.amt} mEq ÷ ${hrs} h = <b>${dose} mEq/hr</b> DOSE → ${fmtNum(rate, 1)} mL/h. VTBI ${c.vol} mL.`,
      steps: [`CHANNEL SELECT → Guardrails Drugs → Potassium Chloride → ${concLabel(d, c)} → Yes → CONFIRM → NEXT`, `DOSE ${dose} → VTBI ${c.vol} → START`],
    };
  }

  function holdOrder(spec, drugId, badDoses) {
    const o = continuous(spec, drugId, badDoses, { hold: true });
    if (!o) return null;
    const d = profileDrug(spec, drugId);
    o.math = `${fmtNum(o.dose, 3)} ${doseUnitLabel(d)} is above the Guardrails <b>hard limit</b> of ${fmtNum(d.limits.hardMax, 3)}. The pump will not run it. Hold and clarify the order with the provider.`;
    o.steps = [`Program ${d.name} as ordered. The pump shows a hard-limit alert.`, "Press Reprogram, then click “Can't give: hold and clarify” in the practice panel."];
    return o;
  }

  const MEDSURG_FLUIDS = ["ns", "lr", "d5halfns", "d5ns", "d5halfnsk"];
  const GEN = {
    medsurg: [
      () => fluid("medsurg", pick(MEDSURG_FLUIDS), [40, 60, 75, 80, 90, 100, 120]),
      () => secondary("medsurg", "ciprofloxacin", [60], pick(MEDSURG_FLUIDS), [50, 75, 100]),
      () => secondary("medsurg", "metronidazole", [60], pick(MEDSURG_FLUIDS), [50, 75, 100]),
      () => secondary("medsurg", "vancomycin", [90, 120], pick(MEDSURG_FLUIDS), [40, 75, 80]),
      () => secondary("medsurg", "piptazo", [30, 240], pick(MEDSURG_FLUIDS), [50, 75, 100]),
      () => secondary("medsurg", "cefazolin", [30, 60], pick(MEDSURG_FLUIDS), [60, 80, 100]),
      () => continuous("medsurg", "heparin", [10, 12, 14, 15, 16], { tail: " per protocol" }),
      () => titrate("medsurg", "heparin", [12, 14, 15, 16], 1, { multipliers: [1, 2, 3], down: Math.random() < 0.4, reason: "aPTT result, per protocol:" }),
      magIntermittent, kclRider,
    ],
    icu: [
      () => continuous("icu", "norepinephrine", [3, 5, 6, 8, 10, 12]),
      () => continuous("icu", "epinephrine", [1, 2, 3, 5]),
      () => continuous("icu", "vasopressin", [0.03, 0.04]),
      () => continuous("icu", "phenylephrine", [20, 40, 50, 80, 100]),
      () => continuous("icu", "dopamine", [3, 5, 8, 10]),
      () => continuous("icu", "dobutamine", [2.5, 5, 7.5, 10]),
      () => continuous("icu", "propofol", [10, 15, 20, 25, 30]),
      () => continuous("icu", "dexmedetomidine", [0.2, 0.4, 0.6, 0.8]),
      () => continuous("icu", "fentanyl", [25, 50, 75, 100]),
      () => continuous("icu", "midazolam", [1, 2, 3, 4]),
      () => continuous("icu", "insulin", [2, 3, 4, 6, 8]),
      () => continuous("icu", "diltiazem", [5, 10, 15]),
      () => continuous("icu", "nicardipine", [2.5, 5, 7.5, 10]),
      () => continuous("icu", "amiodarone", [0.5, 1]),
      () => continuous("icu", "esmolol", [50, 100, 150]),
      () => continuous("icu", "nitroglycerin", [15, 20, 25, 30]),
      () => titrate("icu", "norepinephrine", [6, 8, 10], 2, { multipliers: [1, 2], reason: "MAP 58:" }),
      () => titrate("icu", "propofol", [15, 20, 25], 5, { down: Math.random() < 0.5, reason: "RASS target not met:" }),
      () => titrate("icu", "insulin", [3, 4, 5, 6], 1, { multipliers: [1, 2], down: Math.random() < 0.5, reason: "Glucose per protocol:" }),
      () => titrate("icu", "diltiazem", [5, 10], 2.5, { multipliers: [1, 2], reason: "HR 128:" }),
      () => holdOrder("icu", "dopamine", [35, 40]),
      () => holdOrder("icu", "insulin", [35, 40]),
      () => holdOrder("icu", "fentanyl", [350, 400]),
      () => holdOrder("icu", "propofol", [90, 100]),
    ],
    ld: [
      () => continuous("ld", "oxytocin", [1, 3, 6, 8, 10, 12]),
      () => titrate("ld", "oxytocin", [6, 8, 10], 2, { reason: "Contractions every 5 min, FHR reassuring:" }),
      magOB,
      () => fluid("ld", pick(["lr", "ns"]), [100, 150, 200]),
      () => { const r = pick([125, 150, 167, 250]); const o = fluid("ld", "oxytocinPP", [r]); o.text = `<b>Oxytocin 30 units in 500 mL</b> postpartum at <b>${r} mL/hr</b> until the bag is complete.`; o.steps = ["CHANNEL SELECT → Guardrails Drugs → Oxytocin POSTPARTUM → Yes → CONFIRM", `RATE ${r} → VTBI 500 → START`]; return o; },
      () => secondary("ld", "clindamycin", [30, 60], "lr", [100, 125]),
      () => secondary("ld", "cefazolin", [30], "lr", [100, 150]),
      () => holdOrder("ld", "oxytocin", [36, 40]),
    ],
    peds: [pedsBolus, pedsMaintenance, pedsBlood,
      () => secondary("peds", "ceftriaxone", [30, 60], "d5halfns", [pick([20, 30, 40, 44, 52])]),
    ],
  };

  function newOrder(filter) {
    for (let i = 0; i < 60; i++) {
      const spec = filter && filter !== "all" ? filter : pick(Object.keys(GEN));
      const o = pick(GEN[spec])();
      if (!o) continue;
      if (excluded(`${o.drugId}:${o.rate}`) || (o.dose != null && excluded(`${o.drugId}:d${o.dose}`))) continue;
      o.patient.mrn = String(randInt(400000, 899999));
      o.patient.unit = UNIT[o.spec];
      o.profile = o.spec;
      o.drug = profileDrug(o.spec, o.drugId);
      o.conc = o.drug.concs[o.concIdx];
      return o;
    }
    return null;
  }

  // Put the pump in a ready state for this order: on, profile set, lines primed.
  function setup(P, o) {
    const chB = { ch: "B" };
    const chA = { ch: "A" };
    if (o.kind === "secondary") {
      Object.assign(chA, { drugId: o.primary.drugId, rate: o.primary.rate, vtbi: 1000, remaining: randInt(400, 900), bagName: profileDrug(o.spec, o.primary.drugId).name,
        bedside: { secondaryHung: true, secondaryClampOpen: true, secondaryBag: o.vtbi + 5, secondaryBagName: `${o.drug.name} ${concLabel(o.drug, o.conc)}` } });
    } else if (o.kind === "titrate") {
      Object.assign(chA, { drugId: o.drugId, concIdx: o.concIdx, dose: o.fromDose, vtbi: o.conc.vol, remaining: Math.round(o.conc.vol * 0.7) });
    }
    P.preset({ patientId: o.patient.mrn, profile: o.profile, weight: o.kind === "titrate" ? o.patient.weight : null, channels: [chA, chB] });
  }

  const close = (a, b) => a != null && Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.005);

  // Returns null until the student acts, then { ok, items: [{label, ok, want, got}] }.
  function evaluate(S, o, X) {
    const evts = S.log.slice(X.logStart);
    const find = (t) => evts.find((e) => e.type === t);
    const d = o.drug;
    const doseU = d.dose ? doseUnitLabel(d) : "";
    if (o.kind === "hold") {
      if (X.held) {
        const saw = evts.some((e) => e.type === "hardLimit" && e.drugId === o.drugId);
        return { ok: saw, items: [
          { label: "Programmed the order and saw the hard limit", ok: saw, want: "Hard-limit alert", got: saw ? "Hard-limit alert" : "Not programmed" },
          { label: "Held the dose and clarified the order", ok: true, want: "Hold", got: "Hold" }] };
      }
      const st = find("start");
      if (st) return { ok: false, items: [{ label: "Hold and clarify (dose is above the hard limit)", ok: false, want: "Hold, do not start", got: `Started ${DRUGS[st.drugId] ? DRUGS[st.drugId].name : "infusion"} ${st.dose != null ? st.dose + " " + doseU : st.rate + " mL/h"}` }] };
      return null;
    }
    if (X.held) return { ok: false, items: [{ label: "This order is within Guardrails limits", ok: false, want: "Program it and press START", got: "Held the order" }] };
    if (o.kind === "titrate") {
      const t = find("titrate");
      if (!t) return null;
      return grade([
        ["New dose", t.toDose, o.dose, doseU],
        ["Rate", t.toRate, o.rate, "mL/h"],
      ]);
    }
    const type = o.kind === "secondary" ? "startSecondary" : "start";
    const e = find(type) || (o.kind === "secondary" ? find("start") : null);
    if (!e) return null;
    const items = [];
    if (e.type !== type) items.push({ label: "Programmed as a SECONDARY", ok: false, want: "SECONDARY soft key", got: "New primary" });
    items.push({ label: "Guardrails entry", ok: e.mode === "guardrails" && e.drugId === o.drugId, want: d.name, got: e.mode === "basic" ? "Basic Infusion (no limits)" : (DRUGS[e.drugId] || {}).name || e.drugId });
    if (d.concs.length > 1 && o.conc.amt) items.push({ label: "Concentration", ok: e.drugId === o.drugId && e.concVol === o.conc.vol && (e.concAmt == null || e.concAmt === o.conc.amt), want: concLabel(d, o.conc), got: e.concVol ? `${e.concAmt != null ? fmtNum(e.concAmt, 3) + " " + o.conc.unit + " / " : ""}${e.concVol} mL` : "—" });
    if (o.perKg) items.push({ label: "Patient weight", ok: close(e.weight, o.patient.weight), want: `${o.patient.weight} kg`, got: e.weight ? `${e.weight} kg` : "—" });
    const rows = [];
    if (o.dose != null && d.dose) rows.push(["Dose", e.dose, o.dose, doseU]);
    rows.push(["Rate", e.rate, o.rate, "mL/h"], ["VTBI", e.vtbi, o.vtbi, "mL"]);
    const g = grade(rows);
    const all = items.concat(g.items);
    if (e.overrides) all.push({ label: "No soft-limit override needed", ok: false, want: "No override", got: "Overrode a soft limit" });
    return { ok: all.every((i) => i.ok), items: all };
  }

  function grade(rows) {
    const items = rows.map(([label, got, want, unit]) => ({ label, ok: close(got, want), want: `${fmtNum(want, 3)} ${unit}`, got: got != null ? `${fmtNum(got, 3)} ${unit}` : "—" }));
    return { ok: items.every((i) => i.ok), items };
  }

  // Steps for the single-channel pump (spectrum.js), built from the order.
  const KEYS = { 1: "ABC", 2: "DEF", 3: "GHI", 4: "JKL", 5: "MNO", 6: "PQR", 7: "STU", 8: "VWX", 9: "YZ" };
  const TIMES = ["once", "twice", "3 times"];
  function letterKeys(name) {
    const L = name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2).split("");
    const keyOf = (c) => Object.keys(KEYS).find((k) => KEYS[k].includes(c));
    return L.map((c, i) => {
      const k = keyOf(c), n = KEYS[k].indexOf(c);
      const wait = i > 0 && keyOf(L[i - 1]) === k ? "wait a second, then " : "";
      return `${wait}<b>${c}</b> = key ${k} ${TIMES[n]}`;
    }).join(", ");
  }
  const hhmm = (min) => (min >= 60 ? `${Math.floor(min / 60)}${String(min % 60).padStart(2, "0")}` : String(min));

  function sqSteps(o) {
    const d = o.drug, c = o.conc;
    const find = `Drug Search: type ${letterKeys(d.name)} → pick <b>${d.name}</b> with ▲▼ → OK${d.concs.length > 1 ? ` → concentration <b>${concLabel(d, c)}</b> → OK` : ""} → CONFIRM <b>yes</b>${d.highAlert ? " → advisory <b>continue</b>" : ""}`;
    const startIt = "Check the screen against the order → <b>RUN/STOP</b> → Check Flow <b>yes</b>";
    if (o.kind === "titrate") return ["RUN screen → <b>dose change</b>", `Type ${fmtNum(o.dose, 3)} → OK (rate becomes ${fmtNum(o.rate, 1)} mL/hr)`, "<b>RUN/STOP</b> to apply the new dose"];
    if (o.kind === "secondary") return ["<b>RUN/STOP</b> to stop the primary → <b>program pri/sec</b> → <b>program secndry</b>", find,
      `VTBI shows ${fmtNum(o.vtbi)} (the bag) → OK → reminder popup → OK`, `Time <b>${hhmm(o.minutes)}</b> (${durText(o.minutes)}) → OK (rate ${fmtNum(o.rate, 1)} mL/hr)`, "<b>RUN/STOP</b> → Secondary Check Flow <b>yes</b>"];
    if (o.kind === "hold") return [find, `${o.perKg ? `Patient Weight ${o.patient.weight} → OK, then ` : ""}Dose ${fmtNum(o.dose, 3)} → OK. The pump shows a hard-limit alert.`, "Press OK on the alert, then click “Can't give: hold and clarify” in the practice panel."];
    const ivpb = /IVPB/i.test(d.cls) && !d.dose;
    const steps = [find];
    if (ivpb) steps.push("Delivery bag: <b>Primary Bag</b> → OK");
    if (d.dose && o.dose != null) {
      steps.push(`${o.perKg ? `Patient Weight <b>${o.patient.weight}</b> → OK → ` : ""}Dose <b>${fmtNum(o.dose, 3)}</b> → OK → VTBI <b>${fmtNum(o.vtbi)}</b> → OK`);
    } else if (ivpb) {
      steps.push(`VTBI ${fmtNum(o.vtbi)} → OK → Time or Rate <b>${fmtNum(o.rate, 1)}</b> → OK`);
    } else {
      steps.push(`Rate <b>${fmtNum(o.rate, 1)}</b> → OK → VTBI <b>${fmtNum(o.vtbi)}</b> → OK`);
    }
    steps.push(startIt);
    return steps;
  }

  return { SPECIALTIES, newOrder, setup, evaluate, sqSteps };
})();
