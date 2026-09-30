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

  // Worked math with the concentration in the dose's own unit, e.g.
  // 0.1 mcg/kg/min × 80 kg × 60 min = 480 mcg/h ÷ 32 mcg/mL = 15 mL/h.
  function doseMath(d, c, dose, weight, rate) {
    const u = d.dose.unit, uLbl = u === "g" ? "g" : u;
    const perMl = (c.amt * UNIT_FACTORS[c.unit]) / UNIT_FACTORS[u] / c.vol;
    const perHr = dose * (d.dose.perKg ? weight : 1) * (d.dose.time === "min" ? 60 : 1);
    const steps = d.dose.perKg || d.dose.time === "min" ? ` = ${fmtNum(perHr, 3)} ${uLbl}/h` : "";
    return `${fmtNum(dose, 3)} ${doseUnitLabel(d)}${d.dose.perKg ? ` × ${weight} kg` : ""}${d.dose.time === "min" ? " × 60 min" : ""}${steps} ÷ ${fmtNum(perMl, 3)} ${uLbl}/mL = <b>${fmtNum(rate, 1)} mL/h</b>`;
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
      text: `<b>${d.generic || d.name} ${concText(d, c)}</b>. ${opts.verb || "Start at"} <b>${fmtNum(dose, 3)} ${unit}</b>${opts.tail || ""}.`,
      math: `${doseMath(d, c, dose, p.weight, rate)}. VTBI = ${fmtNum(c.vol)} mL.`,
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
      text: `<b>${d.generic || d.name} ${concText(d, c)}</b> is running on Channel A at ${fmtNum(from, 3)} ${unit}.<br>${opts.reason || "New order:"} <b>${to > from ? "Increase" : "Decrease"} to ${fmtNum(to, 3)} ${unit}</b>.`,
      math: `${doseMath(d, c, to, p.weight, rate)}. Change the DOSE, not the rate.`,
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
      () => continuous("icu", "norepinephrineKg", [0.02, 0.05, 0.08, 0.1, 0.15]),
      () => continuous("icu", "epinephrineKg", [0.02, 0.05, 0.08, 0.1]),
      () => continuous("icu", "phenylephrineKg", [0.25, 0.5, 1, 1.5]),
      () => titrate("icu", "norepinephrineKg", [0.05, 0.08, 0.1], 0.02, { multipliers: [1, 2], reason: "MAP 58:" }),
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

  // Level 1 bank entry (level1.js) -> order object.
  function bankOrder(b) {
    const spec = "medsurg", [name, age, weight] = b.pt;
    const p = { name, age: `${age} y`, weight, mrn: String(randInt(400000, 899999)), unit: UNIT[spec] };
    const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)}${String(min % 60).padStart(2, "0")}` : String(min));
    let o;
    if (b.t === "p") {
      const d = profileDrug(spec, b.f), ci = d.concs.findIndex((c) => c.vol === b.bag);
      const vtbi = b.vol || b.bag, rate = b.rate || r1(b.vol / b.hrs);
      o = { spec, kind: "primary", drugId: b.f, concIdx: ci, rate, vtbi, patient: p,
        text: b.rate
          ? `<b>${d.name}</b> IV at <b>${rate} mL/hr</b>. Bag on hand: ${b.bag} mL.<br><span class="policy">${b.dx}.</span>`
          : `<b>${d.name} ${b.vol} mL</b> IV over <b>${durText(b.hrs * 60)}</b>. Bag on hand: ${b.bag} mL.<br><span class="policy">${b.dx}.</span>`,
        math: b.rate ? `Rate-based fluid: RATE ${rate} mL/h, VTBI ${vtbi} mL (the bag volume).` : `${b.vol} mL ÷ ${b.hrs} h = <b>${fmtNum(rate, 1)} mL/h</b>. VTBI ${vtbi} mL.`,
        steps: [`CHANNEL SELECT → Guardrails IV Fluids → ${d.name}${d.concs.length > 1 ? ` → ${b.bag} mL` : ""} → Yes`, `RATE ${fmtNum(rate, 1)} → VTBI ${vtbi} → START`] };
    } else {
      const d = profileDrug(spec, b.d), c = d.concs[b.c], pf = profileDrug(spec, b.pf);
      const rate = r1(c.vol / (b.min / 60));
      o = { spec, kind: "secondary", drugId: b.d, concIdx: b.c, rate, vtbi: c.vol, patient: p, minutes: b.min, primary: { drugId: b.pf, rate: b.pr },
        text: `<b>${d.name} ${fmtNum(c.amt, 3)} ${c.unit}</b> IVPB in ${fmtNum(c.vol)} mL, infuse over <b>${durText(b.min)}</b>.<br><span class="policy">${b.dx}. ${pf.name} is running on Channel A at ${b.pr} mL/hr. The secondary bag is hung above the primary with its clamp open.</span>`,
        math: `${fmtNum(c.vol)} mL ÷ ${r2(b.min / 60)} h = <b>${fmtNum(rate, 1)} mL/h</b>. VTBI = ${fmtNum(c.vol)} mL. (Or type DURATION ${hm(b.min)}.)`,
        steps: [`CHANNEL SELECT on A → SECONDARY → ${d.name}${d.concs.length > 1 ? ` → ${concLabel(d, c)}` : ""} → Yes`, `VTBI is pre-filled (${fmtNum(c.vol)}). DURATION ${hm(b.min)} (${durText(b.min)}) → START`] };
    }
    o.profile = spec;
    o.drug = profileDrug(spec, o.drugId);
    o.conc = o.drug.concs[o.concIdx];
    return o;
  }

  // opts.noHold: the pump has no dose limits, so skip orders that rely on a hard-limit alert.
  function newOrder(filter, opts = {}) {
    for (let i = 0; i < 80; i++) {
      const spec = filter && filter !== "all" ? filter : pick(Object.keys(GEN));
      const o = pick(GEN[spec])();
      if (!o) continue;
      if (opts.noHold && o.kind === "hold") continue;
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
    // New starts begin at "New patient?" and the unit; running infusions stay mid-shift.
    const fresh = !o.syr && (o.kind === "primary" || o.kind === "hold");
    P.preset({ patientId: o.patient.mrn, profile: o.profile, weight: o.kind === "titrate" ? o.patient.weight : null, channels: [chA, chB], fresh,
      syringe: o.syrSize ? { brand: o.syrBrand.toUpperCase(), size: o.syrSize } : null });
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
    if (e.pump === "syr") return gradeSyringe(e, o);
    const items = [];
    const plum = e.pump === "plum";
    if (e.type !== type) items.push(plum
      ? { label: "Line B in Piggyback mode", ok: false, want: "Piggyback on Line B", got: e.concurrent ? "Concurrent" : "Programmed as a new primary" }
      : { label: "Programmed as a SECONDARY", ok: false, want: "SECONDARY soft key", got: "New primary" });
    const dn = (id) => (DRUGS[id] || {}).name || id;
    if (plum && d.dose) {
      items.push({ label: "Drug + Dose Calculation", ok: e.therapy === "dosecalc" && e.drugId === o.drugId, want: `${d.name}, Dose Calculation`, got: e.therapy === "dosecalc" ? `${e.drugId ? dn(e.drugId) : "No Drug Selected"}, Dose Calculation` : "Rate only (no Dose Calculation)" });
      const wantU = doseUnitLabel(d).replace(/^g\//, "grams/").replace(/^milliunits/, "mUn");
      if (e.therapy === "dosecalc") items.push({ label: "Dose units", ok: e.doseUnit === wantU, want: wantU, got: e.doseUnit });
    } else if (plum) {
      // No dose on a rate-only order: the drug name is optional, but must not be the wrong drug.
      if (e.drugId && e.drugId !== o.drugId) items.push({ label: "Drug name", ok: false, want: d.name, got: dn(e.drugId) });
    } else items.push({ label: "Guardrails entry", ok: e.mode === "guardrails" && e.drugId === o.drugId, want: d.name, got: e.mode === "basic" ? "Basic Infusion (no limits)" : dn(e.drugId) });
    if (e.type === "start" && e.profile !== undefined && PROFILES[o.profile]) items.push({ label: "Unit (profile)", ok: e.profile === o.profile, want: PROFILES[o.profile].name, got: PROFILES[e.profile] ? PROFILES[e.profile].name : "—" });
    if ((plum ? !!d.dose : d.concs.length > 1) && o.conc.amt) items.push({ label: "Concentration", ok: e.drugId === o.drugId && e.concVol === o.conc.vol && (e.concAmt == null ? !plum : Math.abs(e.concAmt - o.conc.amt) < 1e-6), want: concLabel(d, o.conc), got: e.concVol ? `${e.concAmt != null ? fmtNum(e.concAmt, 3) + " " + o.conc.unit + " / " : ""}${e.concVol} mL` : "—" });
    if (o.perKg) items.push({ label: "Patient weight", ok: close(e.weight, o.patient.weight), want: `${o.patient.weight} kg`, got: e.weight ? `${e.weight} kg` : "—" });
    const rows = [];
    if (o.dose != null && d.dose) rows.push(["Dose", e.dose, o.dose, doseU]);
    rows.push(["Rate", e.rate, o.rate, "mL/h"], ["VTBI", e.vtbi, o.vtbi, "mL"]);
    const g = grade(rows);
    const all = items.concat(g.items);
    if (e.overrides) all.push({ label: "No soft-limit override needed", ok: false, want: "No override", got: "Overrode a soft limit" });
    return { ok: all.every((i) => i.ok), items: all };
  }

  const SYR_MODE_NAMES = { mlhr: "mL/hr", voltime: "Volume/time", dose: "Drug library (dose)", dosekg: "Drug library (dose/kg)" };
  function gradeSyringe(e, o) {
    const d = o.drug, int = d.mode === "int";
    const pn = (id) => (SYR_PROFILES[id] ? SYR_PROFILES[id].name : "—");
    // Drips: the library program (dose/kg). Intermittent doses: the library program or volume/time.
    const modeOk = int ? ["voltime", "dose"].includes(e.pm) : e.pm === "dosekg";
    const items = [
      { label: "Profile", ok: e.profile === o.syrProfile, want: pn(o.syrProfile), got: pn(e.profile) },
      { label: "Infusion mode", ok: modeOk, want: int ? "Drug library program or Volume/time" : `Drug library program (dose/kg/${d.dose.time === "min" ? "min" : "hr"})`, got: SYR_MODE_NAMES[e.pm] || "—" }];
    const lib = e.pm === "dose" || e.pm === "dosekg";
    if (lib) items.push({ label: "Drug program", ok: e.drugId === o.drugId, want: d.prog, got: SYR_DRUGS[e.drugId] ? SYR_DRUGS[e.drugId].prog : "—" },
      { label: "Patient weight", ok: close(e.weight, o.patient.weight), want: `${o.patient.weight} kg`, got: e.weight ? `${e.weight} kg` : "—" });
    if (o.syrSize) items.push(
      { label: "Syringe type", ok: e.syrType === o.syrBrand.toUpperCase(), want: o.syrBrand, got: e.syrType || "—" },
      { label: "Syringe size", ok: e.syrSize === o.syrSize, want: `${o.syrSize} mL`, got: e.syrSize ? `${e.syrSize} mL` : "—" });
    const rows = !int ? [["Dose", e.pm === "dosekg" ? e.dose : null, o.dose, doseUnitLabel(d)]]
      : e.pm === "voltime" ? [["Volume", e.vtbi, o.vtbi, "mL"], ["Time", e.time, o.minutes, "min"]]
      : [["Dose", e.total, o.dose, d.dose.unit], ["Time", e.time, o.minutes, "min"]];
    rows.push(["Rate", e.rate, o.rate, "mL/h"]);
    const all = items.concat(grade(rows).items);
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

  // Steps for the dual-line cassette pump (plum.js).
  const plumUnit = (d) => doseUnitLabel(d).replace(/^g\//, "grams/").replace(/^milliunits/, "mUn");
  const plumConcUnit = (u) => (u === "g" ? "grams" : u);
  function plumSteps(o) {
    const d = o.drug, c = o.conc;
    const startIt = "Check Rate, VTBI and Duration against the order → press <b>START</b>";
    if (o.kind === "titrate") return ["Press the <b>[A]</b> soft key (Dose is highlighted)", `Type <b>${fmtNum(o.dose, 3)}</b> (rate becomes ${fmtNum(o.rate, 1)} mL/hr)`, "Press <b>START</b> to accept the new dose"];
    const pickDrug = (key) => `Press <b>[${key}]</b> → drug list: <b>${d.generic || d.name}</b> (SELECT ▲▼, Page Down, or letters on the number keys: 1 = ABC …) → <b>Enter</b>`;
    if (o.kind === "secondary") return ["With Line A pumping, " + pickDrug("B").charAt(0).toLowerCase() + pickDrug("B").slice(1), "The program screen shows <b>Mode Piggyback</b> (use Change Mode if it says Concurrent)",
      `Rate <b>${fmtNum(o.rate, 1)}</b> → <b>▼</b> → VTBI <b>${fmtNum(o.vtbi)}</b> (Duration fills in as ${durText(o.minutes)})`, "Press <b>START</b>. Line A shows DELAYED and restarts by itself when B finishes"];
    if (d.dose && o.dose != null) {
      return [pickDrug("A"),
        `Dose units <b>${plumUnit(d)}</b> → Choose → container units <b>${plumConcUnit(c.unit)}</b> → Choose`,
        `Conc <b>${fmtNum(c.amt, 3)}</b> ${plumConcUnit(c.unit)} → ▼ → <b>${fmtNum(c.vol)}</b> mL${o.perKg ? ` → ▼ → Weight <b>${o.patient.weight}</b> kg` : ""}`,
        `▼ → Dose <b>${fmtNum(o.dose, 3)}</b> → ▼ → VTBI <b>${fmtNum(o.vtbi)}</b> (rate ${fmtNum(o.rate, 1)} mL/hr)`,
        "Press <b>START</b> → Confirm Program? <b>Yes</b>"];
    }
    return [pickDrug("A"), `Rate <b>${fmtNum(o.rate, 1)}</b> → <b>▼</b> → VTBI <b>${fmtNum(o.vtbi)}</b>`, startIt];
  }

  // Steps for the compact arrow-key pump (space.js).
  const dial = (v) => `dial <b>${fmtNum(v, 3)}</b> (◀ ▶ digit, ▲ ▼ value) → OK`;
  const spHm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  function spaceSteps(o) {
    const d = o.drug, c = o.conc;
    const cat = drugCategory(d);
    const find = `<b>${cat.top}</b> → OK${cat.sub ? ` → <b>${cat.sub}</b> → OK` : ""} → ▲▼ to <b>${d.name}</b> (▶ jumps ABC → DEF …) → OK${d.concs.length > 1 ? ` → <b>${concLabel(d, c)}</b> → OK` : ""}${d.highAlert ? " → advisory: OK" : ""}`;
    if (o.kind === "titrate") return ["On the run screen press <b>◀</b> (Doserate editor opens)", `${dial(o.dose)}. The new doserate starts when you press OK (rate ${fmtNum(o.rate, 1)} ml/h)`];
    if (o.kind === "secondary") return ["<b>Start/Stop</b> to stop the primary → ▼ to <b>SECondary</b> → OK → <b>New SECondary</b> → OK", find,
      `VTBI shows ${fmtNum(o.vtbi)} ml (the bag): OK → OK`, `▼ to <b>Time</b> → OK → dial <b>${spHm(o.minutes)}</b> → OK (rate ${fmtNum(o.rate, 1)} ml/h)`, "<b>Start/Stop</b> → check bag height, open SEC clamp → <b>Start/Stop</b>"];
    if (o.kind === "hold") return [`OK → Care Unit <b>${PROFILES[o.profile].name.replace("Adult ", "")}</b> → OK → ` + find, `${o.perKg ? `Weight: ${dial(o.patient.weight)}, then ` : ""}dial toward ${fmtNum(o.dose, 3)}: the editor stops at the hard limit and ▲ again shows the hard-limit message`, "OK, then click “Can't give: hold and clarify” in the practice panel."];
    const steps = [`Press <b>OK</b> → Care Unit <b>${PROFILES[o.profile].name.replace("Adult ", "")}</b> → OK → ` + find];
    if (d.dose && o.dose != null) {
      if (o.perKg) steps.push(`Weight editor: ${dial(o.patient.weight)}`, "OK to open Doserate");
      steps.push(`Doserate: ${dial(o.dose)} (rate ${fmtNum(o.rate, 1)} ml/h)`);
    } else steps.push(`Rate: ${dial(o.rate)}`);
    steps.push(`VTBI is highlighted: OK → ${dial(o.vtbi)}`, "<b>START</b> shows on the top line: check it, press <b>Start/Stop</b>");
    return steps;
  }

  // ---------------------------------------------------------------- syringe pump orders
  const SYR_CONT = {
    syr_fentanyl: [0.5, 1, 1.5, 2], syr_morphine: [10, 20, 30], syr_midazolam: [0.05, 0.1, 0.15], syr_dexmed: [0.3, 0.5, 0.8],
    syr_dobutamine: [5, 7.5, 10], syr_dopamine: [5, 7.5, 10], syr_epinephrine: [0.05, 0.1, 0.2], syr_milrinone: [0.25, 0.5, 0.75],
    syr_insulin: [0.05, 0.1], syr_heparin: [10, 15, 20],
    syr_fentanyl_n: [0.5, 1, 1.5, 2], syr_morphine_n: [10, 15, 20], syr_dobutamine_n: [5, 7.5, 10], syr_dopamine_n: [5, 7.5, 10],
    syr_epinephrine_n: [0.05, 0.1], syr_insulin_n: [0.02, 0.05],
  };
  const SYR_INT = {
    syr_ampicillin: [[25, 50, 100], [15, 30]], syr_cefoxitin: [[30, 40], [30]], syr_vancomycin: [[10, 15], [60]], syr_gentamicin: [[4, 5], [30]],
    syr_acyclovir: [[10, 20], [60]], syr_calcium: [[50, 100], [30, 60]], syr_kcl: [[0.5, 1], [60, 120]],
  };
  const SYR_HOLD = { syr_fentanyl: [6, 8], syr_dopamine: [25, 30], syr_milrinone: [1.5, 2], syr_heparin: [50, 60], syr_fentanyl_n: [6, 8], syr_dopamine_n: [25, 30] };

  function syrPatient(unit) {
    if (unit === "NICU") {
      const w = randInt(6, 40) / 10;
      return { name: `Baby ${pick(["Girl", "Boy"])} ${pick(LAST)}`, age: `${randInt(1, 40)} days (${randInt(26, 40)} wk GA)`, weight: w };
    }
    const w = randInt(5, 40);
    return { name: `${pick(KID_FIRST)} ${pick(LAST)}`, age: w < 10 ? `${randInt(6, 18)} months` : `${Math.max(2, Math.round((w - 8) / 2))} y`, weight: w };
  }
  const profFor = (unit, mode, drugId) => {
    const ids = Object.keys(SYR_PROFILES).filter((pid) => SYR_PROFILES[pid].unit === unit && (SYR_PROFILES[pid].mode === mode || SYR_PROFILES[pid].mode === "both") && SYR_PROFILES[pid].drugs.includes(drugId));
    return ids[0];
  };
  function syrContinuous(kind) {
    const unit = pick(["NICU", "PICU", "PICU", "AcuteCare"]);
    const table = kind === "hold" ? SYR_HOLD : SYR_CONT;
    const ids = Object.keys(table).filter((id) => profFor(unit, "cont", id));
    if (!ids.length) return null;
    const drugId = pick(ids), d = SYR_DRUGS[drugId], c = d.concs[0];
    const p = syrPatient(unit);
    let dose = pick(table[drugId]), fromDose = null;
    if (kind === "titrate") {
      const opts = SYR_CONT[drugId];
      if (opts.length < 2) return null;
      const i = randInt(0, opts.length - 2);
      [fromDose, dose] = Math.random() < 0.6 ? [opts[i], opts[i + 1]] : [opts[i + 1], opts[i]];
    }
    const rate = r2(doseToRate(d, c, dose, p.weight));
    if (rate < 0.1 || rate > 100) return null;
    const u = doseUnitLabel(d);
    const o = { spec: unit, kind, drugId, concIdx: 0, dose, rate, vtbi: null, patient: p, perKg: true, syr: true, syrProfile: profFor(unit, "cont", drugId), fromDose,
      text: kind === "titrate"
        ? `<b>${d.name} (${d.prog.toLowerCase().replace(/ml/g, "mL")})</b> is running at ${fmtNum(fromDose, 3)} ${u}.<br>New order: <b>${dose > fromDose ? "Increase" : "Decrease"} to ${fmtNum(dose, 3)} ${u}</b>.`
        : `<b>${d.name}</b> continuous infusion at <b>${fmtNum(dose, 3)} ${u}</b>. Syringe: ${d.prog.toLowerCase().replace(/ml/g, "mL")}.`,
      math: `${doseMath(d, c, dose, p.weight, rate)}.${kind === "titrate" ? " Use CHG DOSE, then START." : ""}` };
    if (kind === "hold") o.math = `${fmtNum(dose, 3)} ${u} is above the hard limit of ${fmtNum(d.limits.hardMax, 3)} ${u}. The pump will not accept it. Hold and clarify the order.`;
    return o;
  }
  function syrIntermittent() {
    const unit = pick(["NICU", "PICU", "AcuteCare"]);
    const ids = Object.keys(SYR_INT).filter((id) => profFor(unit, "int", id));
    if (!ids.length) return null;
    const drugId = pick(ids), d = SYR_DRUGS[drugId], c = d.concs[0];
    const p = syrPatient(unit);
    const perKg = pick(SYR_INT[drugId][0]), minutes = pick(SYR_INT[drugId][1]);
    const dose = r2(perKg * p.weight);
    const vol = Math.round((dose / (c.amt / c.vol)) * 1000) / 1000;
    const rate = r2(vol / (minutes / 60));
    if (rate < 0.1 || vol > 60) return null; // must fit in one syringe
    const u = d.dose.unit;
    return { spec: unit, kind: "primary", drugId, concIdx: 0, dose, perKgDose: perKg, rate, vtbi: vol, minutes, patient: p, perKg: true, syr: true, syrProfile: profFor(unit, "int", drugId),
      text: `<b>${d.name} ${fmtNum(dose, 3)} ${u}</b> (${fmtNum(perKg, 3)} ${u}/kg) IV over <b>${durText(minutes)}</b>. Syringe: ${d.prog.toLowerCase().replace(/ml/g, "mL")}.`,
      math: `${fmtNum(perKg, 3)} ${u}/kg × ${p.weight} kg = <b>${fmtNum(dose, 3)} ${u}</b> ÷ ${fmtNum(c.amt / c.vol, 3)} ${u}/mL = ${fmtNum(vol, 3)} mL ÷ ${r2(minutes / 60)} h = <b>${fmtNum(rate, 2)} mL/h</b>.` };
  }
  function syringeOrder() {
    for (let i = 0; i < 60; i++) {
      const r = Math.random();
      const o = r < 0.4 ? syrContinuous("primary") : r < 0.75 ? syrIntermittent() : r < 0.9 ? syrContinuous("titrate") : syrContinuous("hold");
      if (!o || !o.syrProfile) continue;
      o.patient.mrn = String(randInt(400000, 899999));
      o.patient.unit = o.spec;
      o.profile = o.syrProfile;
      // The syringe from pharmacy: a random size that holds the dose (drips: 20-60 mL)
      // and a random brand. Students read both off the syringe on the pump.
      const fits = [1, 3, 5, 10, 20, 30, 60].filter((z) => z >= (o.vtbi || SYR_DRUGS[o.drugId].concs[0].vol));
      o.syrSize = o.kind === "titrate" ? null : pick(fits.slice(0, 3));
      o.syrBrand = pick(["B-D", "Monoject", "Terumo"]);
      o.drug = SYR_DRUGS[o.drugId];
      o.conc = o.drug.concs[0];
      if (o.kind === "titrate") o.conc = o.drug.concs[0];
      return o;
    }
    return null;
  }

  function syrSteps(o) {
    const d = o.drug, prof = SYR_PROFILES[o.syrProfile], w = o.patient.weight;
    const pi = Object.keys(SYR_PROFILES).indexOf(o.syrProfile);
    const profStep = `Profile: ${pi >= 8 ? "<b>MORE</b> → " : ""}<b>${(pi % 8) + 1}</b> (${prof.name.toUpperCase()})`;
    // Library letter group, then the program's number inside it.
    const groups = [["A", "B"], ["C", "D"], ["E", "G"], ["H", "L"], ["M", "O"], ["P", "R"], ["S", "Z"]];
    const first = (x) => x.prog.replace(/[^A-Z]/gi, "").charAt(0).toUpperCase();
    const gi = groups.findIndex(([a, z]) => first(d) >= a && first(d) <= z);
    const inGroup = prof.drugs.map((id) => SYR_DRUGS[id]).filter((x) => first(x) >= groups[gi][0] && first(x) <= groups[gi][1]).sort((a, b) => a.prog.localeCompare(b.prog));
    const lib = `Library <b>${gi + 1}</b> (${groups[gi].join("-")}) → program <b>${inGroup.findIndex((x) => x.id === o.drugId) + 1}</b> (${d.prog})${d.highAlert ? " → <b>CONFIRM</b> (high-alert advisory)" : ""}`;
    const brand = ["B-D", "Monoject", "Terumo"].indexOf(o.syrBrand) + 1;
    const syr = o.syrSize ? `Read the syringe on the pump (<b>${o.syrBrand} ${o.syrSize} mL</b>): syringe type <b>${brand}</b> → <b>LOAD SYRINGE</b>${o.syrSize <= 3 ? ` → pick <b>${o.syrSize} ML</b> → <b>CONFIRM</b>` : " → size recognized → <b>CONFIRM</b>"}` : "";
    const wt = `WEIGHT <b>${w}</b> → ENTER → RE-ENTER WEIGHT <b>${w}</b> → ENTER`;
    const prime = "Prompt alternates START / BOLUS: press <b>BOLUS</b>, press and hold BOLUS until fluid reaches the end of the tubing, <b>EXIT</b> → press <b>START</b>";
    const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}${String(m % 60).padStart(2, "0")}` : m);
    if (o.kind === "titrate") return ["Press the <b>CHG DOSE</b> soft key", `Type <b>${fmtNum(o.dose, 3)}</b> → ENTER (new rate ${fmtNum(o.rate, 2)} mL/h)`, "Press <b>START</b> to confirm the new dose"];
    if (o.kind === "hold") return [profStep, lib, syr, `${wt} → DOSE ${fmtNum(o.dose, 3)} → ENTER: the pump shows the hard limit`, "OK, then click “Can't give: hold and clarify” in the practice panel."];
    if (d.mode === "int") return [profStep, lib, syr,
      `${wt} → DOSE <b>${fmtNum(o.dose, 3)}</b> ${d.dose.unit} → ENTER → TIME <b>${hm(o.minutes)}</b> → ENTER (rate ${fmtNum(o.rate, 2)} mL/h)`,
      prime, "When it finishes: <b>STOP</b> → flush the line if ordered"];
    return [profStep, lib, syr, `${wt} → DOSE <b>${fmtNum(o.dose, 3)}</b> → ENTER (rate ${fmtNum(o.rate, 2)} mL/h)`, prime];
  }

  return { SPECIALTIES, newOrder, bankOrder, setup, evaluate, sqSteps, plumSteps, spaceSteps, syringeOrder, syrSteps };
})();
