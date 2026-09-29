/*
 * Practice drug library (Guardrails-style dose error reduction software).
 *
 * EDUCATIONAL DATA ONLY. Concentrations and limits are representative
 * teaching values, not a clinical reference. Real libraries are built by
 * each facility's pharmacy and differ by care area.
 *
 * Limits are expressed in the drug's dosing unit (or mL/h for fluids and
 * rate-based piggybacks). softMin/softMax can be overridden after
 * verification; hardMin/hardMax cannot be exceeded.
 */

// Converts an amount unit to a common base so dose and concentration
// units can differ (e.g. dose in mcg, bag in mg).
const UNIT_FACTORS = { g: 1000, mg: 1, mcg: 0.001, ng: 0.000001, units: 1, milliunits: 0.001, mEq: 1 };

const DRUGS = {
  // ---------- Fluids (rate-based, mL/h) ----------
  ns: {
    name: "Sodium Chloride 0.9%", short: "NS 0.9%", cls: "IV fluid",
    concs: [{ vol: 1000 }, { vol: 500 }],
    dose: null, limits: { softMin: 10, softMax: 250, hardMax: 999 },
  },
  lr: {
    name: "Lactated Ringer's", short: "LR", cls: "IV fluid",
    concs: [{ vol: 1000 }],
    dose: null, limits: { softMin: 10, softMax: 250, hardMax: 999 },
  },
  d5halfns: {
    name: "Dextrose 5%-NaCl 0.45%", short: "D5 1/2NS", cls: "IV fluid",
    concs: [{ vol: 1000 }],
    dose: null, limits: { softMin: 10, softMax: 200, hardMax: 500 },
  },
  d5halfnsk: {
    name: "D5 0.45% NaCl + KCl 20 mEq/L", short: "D5 1/2NS+20K", cls: "IV fluid w/ potassium",
    concs: [{ vol: 1000 }],
    dose: null, limits: { softMin: 10, softMax: 150, hardMax: 250 },
  },

  d5ns: {
    name: "Dextrose 5%-NaCl 0.9%", short: "D5NS", cls: "IV fluid",
    concs: [{ vol: 1000 }],
    dose: null, limits: { softMin: 10, softMax: 200, hardMax: 500 },
  },
  nsBolus: {
    name: "Sodium Chloride 0.9% BOLUS", short: "NS BOLUS", cls: "Fluid bolus",
    concs: [{ vol: 500 }, { vol: 1000 }, { vol: 250 }],
    dose: null, limits: { softMax: 999, hardMax: 999 },
    note: "Bolus entry: higher rate limits than maintenance NS. Pump maximum is 999 mL/h.",
  },
  prbc: {
    name: "Packed Red Blood Cells", short: "PRBC", cls: "Blood product",
    concs: [{ vol: 300 }, { vol: 350 }],
    dose: null, limits: { softMax: 200, hardMax: 350 },
    note: "Blood tubing primed with 0.9% NaCl ONLY. Complete within 4 hours of spike. Stay with patient first 15 min.",
  },

  // ---------- Intermittent / piggyback (rate-based, mL/h) ----------
  cefazolin: {
    name: "Cefazolin", short: "Cefazolin", cls: "Antibiotic (IVPB)",
    concs: [{ amt: 2, unit: "g", vol: 100 }, { amt: 1, unit: "g", vol: 50 }],
    dose: null, limits: { softMax: 300, hardMax: 999 },
    note: "Usually run as a SECONDARY infusion over 30 min.",
  },
  ceftriaxone: {
    name: "Ceftriaxone", short: "Ceftriaxone", cls: "Antibiotic (IVPB)",
    concs: [{ amt: 1, unit: "g", vol: 50 }],
    dose: null, limits: { softMax: 200, hardMax: 999 },
    note: "Usually run as a SECONDARY infusion over 30 min.",
  },
  vancomycin: {
    name: "Vancomycin", short: "Vancomycin", cls: "Antibiotic (IVPB)",
    concs: [{ amt: 1, unit: "g", vol: 250 }, { amt: 1.5, unit: "g", vol: 500 }],
    dose: null, limits: { softMax: 250, hardMax: 500 },
    note: "Infuse no faster than 1 g/hr to prevent infusion reaction (flushing, hypotension).",
  },
  piptazo: {
    name: "Piperacillin-Tazobactam", short: "Pip-Tazo", cls: "Antibiotic (IVPB)",
    concs: [{ amt: 3.375, unit: "g", vol: 100 }],
    dose: null, limits: { softMax: 200, hardMax: 400 },
  },

  ciprofloxacin: {
    name: "Ciprofloxacin", short: "Cipro", cls: "Antibiotic (IVPB)",
    concs: [{ amt: 400, unit: "mg", vol: 100 }],
    dose: null, limits: { softMax: 100, hardMax: 200 },
    note: "Infuse over 60 min (100 mL/h) to limit venous irritation.",
  },
  metronidazole: {
    name: "metroNIDAZOLE", short: "metroNIDAZOLE", cls: "Antibiotic (IVPB)",
    concs: [{ amt: 500, unit: "mg", vol: 100 }],
    dose: null, limits: { softMax: 100, hardMax: 200 },
    note: "Infuse over 60 min (100 mL/h).",
  },
  clindamycin: {
    name: "Clindamycin", short: "Clindamycin", cls: "Antibiotic (IVPB)",
    concs: [{ amt: 900, unit: "mg", vol: 50 }],
    dose: null, limits: { softMax: 100, hardMax: 200 },
    note: "Do not exceed 30 mg/min (900 mg over at least 30 min).",
  },
  txa: {
    name: "Tranexamic Acid", short: "TXA", cls: "Antifibrinolytic",
    concs: [{ amt: 1, unit: "g", vol: 100 }],
    dose: null, limits: { softMax: 600, hardMax: 999 },
    note: "1 g over 10 min (600 mL/h). Faster infusion can cause hypotension.",
  },

  // ---------- Electrolytes ----------
  kcl: {
    name: "Potassium Chloride", short: "KCl", cls: "Electrolyte", highAlert: true,
    concs: [{ amt: 10, unit: "mEq", vol: 100 }, { amt: 20, unit: "mEq", vol: 100 }],
    dose: { unit: "mEq", perKg: false, time: "hr" },
    limits: { softMax: 10, hardMax: 10 },
    note: "Peripheral line: max 10 mEq/hr. Never IV push.",
  },
  magnesium: {
    name: "Magnesium Sulfate", short: "Mag Sulfate", cls: "Electrolyte", highAlert: true,
    concs: [{ amt: 2, unit: "g", vol: 50 }],
    dose: { unit: "g", perKg: false, time: "hr" },
    limits: { softMin: 0.5, softMax: 2, hardMax: 4 },
  },

  // ---------- Anticoagulant / endocrine ----------
  heparin: {
    name: "Heparin", short: "Heparin", cls: "Anticoagulant", highAlert: true,
    concs: [{ amt: 25000, unit: "units", vol: 250 }, { amt: 25000, unit: "units", vol: 500 }],
    dose: { unit: "units", perKg: true, time: "hr" },
    limits: { softMin: 5, softMax: 25, hardMax: 40 },
    note: "Weight-based protocol. Independent double check required.",
  },
  insulin: {
    name: "Insulin Regular", short: "Insulin Reg", cls: "Antidiabetic", highAlert: true,
    concs: [{ amt: 100, unit: "units", vol: 100 }],
    dose: { unit: "units", perKg: false, time: "hr" },
    limits: { softMin: 0.5, softMax: 15, hardMax: 30 },
    note: "Independent double check required. Check glucose per protocol.",
  },

  // ---------- Vasoactive ----------
  norepinephrine: {
    name: "Norepinephrine", short: "Norepi", cls: "Vasopressor", highAlert: true,
    concs: [{ amt: 4, unit: "mg", vol: 250 }, { amt: 8, unit: "mg", vol: 250 }],
    dose: { unit: "mcg", perKg: false, time: "min" },
    limits: { softMin: 1, softMax: 30, hardMax: 50 },
    note: "Central line preferred. Titrate to MAP goal.",
  },
  epinephrine: {
    name: "Epinephrine", short: "Epi", cls: "Vasopressor", highAlert: true,
    concs: [{ amt: 1, unit: "mg", vol: 250 }],
    dose: { unit: "mcg", perKg: false, time: "min" },
    limits: { softMin: 1, softMax: 10, hardMax: 20 },
  },
  vasopressin: {
    name: "Vasopressin", short: "Vasopressin", cls: "Vasopressor", highAlert: true,
    concs: [{ amt: 20, unit: "units", vol: 100 }],
    dose: { unit: "units", perKg: false, time: "min" },
    limits: { softMin: 0.01, softMax: 0.04, hardMax: 0.1 },
  },
  phenylephrine: {
    name: "Phenylephrine", short: "Phenylephrine", cls: "Vasopressor", highAlert: true,
    concs: [{ amt: 20, unit: "mg", vol: 250 }],
    dose: { unit: "mcg", perKg: false, time: "min" },
    limits: { softMin: 10, softMax: 200, hardMax: 300 },
  },
  dopamine: {
    name: "DOPamine", short: "DOPamine", cls: "Inotrope/vasopressor", highAlert: true,
    concs: [{ amt: 400, unit: "mg", vol: 250 }],
    dose: { unit: "mcg", perKg: true, time: "min" },
    limits: { softMin: 2, softMax: 20, hardMax: 30 },
    note: "Tall Man lettering: DOPamine vs DOBUTamine.",
  },
  dobutamine: {
    name: "DOBUTamine", short: "DOBUTamine", cls: "Inotrope", highAlert: true,
    concs: [{ amt: 250, unit: "mg", vol: 250 }],
    dose: { unit: "mcg", perKg: true, time: "min" },
    limits: { softMin: 2, softMax: 20, hardMax: 40 },
    note: "Tall Man lettering: DOBUTamine vs DOPamine.",
  },
  nitroglycerin: {
    name: "Nitroglycerin", short: "NTG", cls: "Vasodilator",
    concs: [{ amt: 50, unit: "mg", vol: 250 }],
    dose: { unit: "mcg", perKg: false, time: "min" },
    limits: { softMin: 5, softMax: 200, hardMax: 400 },
  },
  nicardipine: {
    name: "niCARdipine", short: "niCARdipine", cls: "Calcium channel blocker",
    concs: [{ amt: 25, unit: "mg", vol: 250 }],
    dose: { unit: "mg", perKg: false, time: "hr" },
    limits: { softMin: 2.5, softMax: 15, hardMax: 15 },
  },
  diltiazem: {
    name: "dilTIAZem", short: "dilTIAZem", cls: "Calcium channel blocker",
    concs: [{ amt: 125, unit: "mg", vol: 125 }],
    dose: { unit: "mg", perKg: false, time: "hr" },
    limits: { softMin: 5, softMax: 15, hardMax: 20 },
  },
  amiodarone: {
    name: "Amiodarone", short: "Amiodarone", cls: "Antiarrhythmic", highAlert: true,
    concs: [{ amt: 450, unit: "mg", vol: 250 }],
    dose: { unit: "mg", perKg: false, time: "min" },
    limits: { softMin: 0.5, softMax: 1, hardMax: 2 },
  },
  esmolol: {
    name: "Esmolol", short: "Esmolol", cls: "Beta blocker",
    concs: [{ amt: 2500, unit: "mg", vol: 250 }],
    dose: { unit: "mcg", perKg: true, time: "min" },
    limits: { softMin: 50, softMax: 300, hardMax: 300 },
  },

  // ---------- Sedation / analgesia ----------
  propofol: {
    name: "Propofol", short: "Propofol", cls: "Sedative", highAlert: true,
    concs: [{ amt: 1000, unit: "mg", vol: 100 }],
    dose: { unit: "mcg", perKg: true, time: "min" },
    limits: { softMin: 5, softMax: 50, hardMax: 80 },
    note: "Change tubing every 12 h. Monitor triglycerides.",
  },
  fentanyl: {
    name: "fentaNYL", short: "fentaNYL", cls: "Opioid", highAlert: true,
    concs: [{ amt: 2500, unit: "mcg", vol: 250 }],
    dose: { unit: "mcg", perKg: false, time: "hr" },
    limits: { softMin: 25, softMax: 200, hardMax: 300 },
  },
  midazolam: {
    name: "Midazolam", short: "Midazolam", cls: "Benzodiazepine", highAlert: true,
    concs: [{ amt: 100, unit: "mg", vol: 100 }],
    dose: { unit: "mg", perKg: false, time: "hr" },
    limits: { softMin: 1, softMax: 10, hardMax: 20 },
  },
  dexmedetomidine: {
    name: "Dexmedetomidine", short: "Dexmed", cls: "Sedative", highAlert: true,
    concs: [{ amt: 400, unit: "mcg", vol: 100 }],
    dose: { unit: "mcg", perKg: true, time: "hr" },
    limits: { softMin: 0.2, softMax: 1.5, hardMax: 2 },
  },

  // ---------- Obstetrics ----------
  oxytocin: {
    name: "Oxytocin INDUCTION", short: "Oxytocin IND", cls: "Uterotonic", highAlert: true,
    concs: [{ amt: 30, unit: "units", vol: 500 }],
    dose: { unit: "milliunits", perKg: false, time: "min" },
    limits: { softMin: 1, softMax: 20, hardMax: 30 },
    note: "Titrate per protocol; stop for tachysystole or non-reassuring FHR.",
  },
  oxytocinPP: {
    name: "Oxytocin POSTPARTUM", short: "Oxytocin PP", cls: "Uterotonic", highAlert: true,
    concs: [{ amt: 30, unit: "units", vol: 500 }],
    dose: null, limits: { softMax: 350, hardMax: 500 },
    note: "Postpartum entry is programmed in mL/h. Never use the INDUCTION entry after delivery.",
  },
  magnesiumOB: {
    name: "Magnesium Sulfate (OB)", short: "Mag OB", cls: "Anticonvulsant (OB)", highAlert: true,
    concs: [{ amt: 40, unit: "g", vol: 1000 }],
    dose: { unit: "g", perKg: false, time: "hr" },
    limits: { softMin: 1, softMax: 3, hardMax: 4 },
    note: "Monitor DTRs, respirations, urine output. Calcium gluconate at bedside.",
  },
};

// Each care-area profile lists the drugs it contains, with optional
// limit overrides (limits differ by care area in real libraries too).
const PROFILES = {
  medsurg: {
    name: "Adult Med-Surg", short: "ADULT MED-SURG",
    drugs: {
      ns: {}, nsBolus: { limits: { softMax: 500, hardMax: 999 } }, lr: {}, d5ns: {}, d5halfns: {}, d5halfnsk: {},
      cefazolin: {}, ceftriaxone: {}, ciprofloxacin: {}, metronidazole: {}, vancomycin: {}, piptazo: {},
      kcl: {}, magnesium: {}, heparin: {}, prbc: {},
    },
  },
  icu: {
    name: "Adult Critical Care / PCU", short: "ADULT ICU/PCU",
    drugs: {
      ns: {}, nsBolus: {}, lr: {}, d5ns: {}, d5halfns: {}, d5halfnsk: {},
      cefazolin: {}, ceftriaxone: {}, ciprofloxacin: {}, metronidazole: {}, vancomycin: {}, piptazo: {},
      kcl: { limits: { softMax: 10, hardMax: 20 }, note: "Central line: soft max 10, hard max 20 mEq/hr with cardiac monitoring." },
      magnesium: {}, heparin: {}, insulin: {}, prbc: {},
      norepinephrine: {}, epinephrine: {}, vasopressin: {}, phenylephrine: {},
      dopamine: {}, dobutamine: {}, nitroglycerin: {}, nicardipine: {},
      diltiazem: {}, amiodarone: {}, esmolol: {},
      propofol: {}, fentanyl: {}, midazolam: {}, dexmedetomidine: {},
    },
  },
  ld: {
    name: "Labor & Delivery / Postpartum", short: "L&D / POSTPARTUM",
    drugs: { ns: {}, lr: {}, nsBolus: {}, cefazolin: {}, clindamycin: {}, oxytocin: {}, oxytocinPP: {}, magnesiumOB: {}, txa: {}, prbc: {} },
  },
  peds: {
    name: "Pediatrics", short: "PEDIATRICS",
    drugs: {
      ns: { limits: { softMin: 2, softMax: 100, hardMax: 250 } },
      nsBolus: { limits: { softMax: 300, hardMax: 500 }, note: "Peds bolus: usually 20 mL/kg over 20-60 min. Double-check the weight-based volume." },
      d5halfns: { limits: { softMin: 2, softMax: 150, hardMax: 250 } },
      d5ns: { limits: { softMin: 2, softMax: 150, hardMax: 250 } },
      ceftriaxone: {}, cefazolin: {},
      prbc: { limits: { softMax: 175, hardMax: 250 } },
    },
  },
};

// Returns the drug as configured in a profile (base entry + overrides).
function profileDrug(profileId, drugId) {
  const p = PROFILES[profileId];
  if (!p || !p.drugs[drugId]) return null;
  const base = DRUGS[drugId];
  const o = p.drugs[drugId];
  return Object.assign({ id: drugId }, base, o, { limits: Object.assign({}, base.limits, o.limits) });
}

function profileDrugList(profileId) {
  return Object.keys(PROFILES[profileId].drugs)
    .map((id) => profileDrug(profileId, id))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function doseUnitLabel(drug) {
  if (!drug || !drug.dose) return "mL/h";
  const d = drug.dose;
  return `${d.unit}${d.perKg ? "/kg" : ""}/${d.time === "min" ? "min" : "hr"}`;
}

function fmtNum(n, max = 2) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: max });
}

function concLabel(drug, conc) {
  if (!conc) return "";
  if (!conc.amt) return `${fmtNum(conc.vol)} mL`;
  return `${fmtNum(conc.amt, 3)} ${conc.unit} / ${fmtNum(conc.vol)} mL`;
}

function concPerMlLabel(conc) {
  if (!conc || !conc.amt) return "";
  return `${fmtNum(conc.amt / conc.vol, 3)} ${conc.unit}/mL`;
}

// Dose (in the drug's dosing unit) -> pump rate in mL/h.
function doseToRate(drug, conc, dose, weight) {
  if (!drug.dose) return dose;
  const d = drug.dose;
  let perHr = dose * (d.perKg ? weight : 1) * (d.time === "min" ? 60 : 1);
  perHr = (perHr * UNIT_FACTORS[d.unit]) / UNIT_FACTORS[conc.unit];
  return perHr / (conc.amt / conc.vol);
}

// Pump rate in mL/h -> dose in the drug's dosing unit.
function rateToDose(drug, conc, rate, weight) {
  if (!drug.dose) return rate;
  const d = drug.dose;
  let perHr = rate * (conc.amt / conc.vol);
  perHr = (perHr * UNIT_FACTORS[conc.unit]) / UNIT_FACTORS[d.unit];
  return perHr / (d.perKg ? weight : 1) / (d.time === "min" ? 60 : 1);
}

function limitsLabel(drug) {
  const l = drug.limits, u = doseUnitLabel(drug), parts = [];
  if (l.softMin != null) parts.push(`soft min ${fmtNum(l.softMin, 3)}`);
  if (l.softMax != null) parts.push(`soft max ${fmtNum(l.softMax, 3)}`);
  if (l.hardMax != null) parts.push(`hard max ${fmtNum(l.hardMax, 3)}`);
  return `${parts.join(" · ")} ${u}`;
}
