/*
 * Practice scenarios built from the ATU Simulation Hospital patients
 * (Level 1, Level 2 OB/Peds, Level 3 Med-Surg/ICU). Orders are taken from
 * the charts; where a pump scenario needed extra detail (bag size, a lab
 * value, a vital sign change) it is marked "sim extension".
 */

const near = (a, b, tol = 0.06) => a != null && Math.abs(a - b) <= tol;
const evs = (S, type, pred) => S.log.filter((e) => e.type === type && (!pred || pred(e)));
const has = (S, type, pred) => evs(S, type, pred).length > 0;
const lastEv = (S, type, pred) => { const l = evs(S, type, pred); return l[l.length - 1]; };
const chan = (S, id) => S.channels[id];

// Common goals reused across scenarios
const G = {
  newPatient: { text: "Press <b>SYSTEM ON</b>, wait for the self test, answer <b>New Patient? → Yes</b>", check: (S) => has(S, "newPatient", (e) => e.yes) },
  patientId: (id) => ({ text: `Enter the patient ID <b>${id}</b> from the armband`, check: (S) => S.patientId === id, negative: (S) => has(S, "patientId", (e) => e.id !== id) }),
  profile: (pid) => ({ text: `Select the <b>${PROFILES[pid].name}</b> profile`, check: (S) => S.profile === pid }),
  primeLoad: (ch) => ({ text: `Prime the tubing and load the set in <b>Channel ${ch}</b>`, check: (S) => chan(S, ch).bedside.primed && chan(S, ch).bedside.loaded }),
  traced: (ch) => ({ text: `Trace the line (bag → pump → patient) <b>before</b> pressing START`, check: (S) => has(S, "start", (e) => e.ch === ch && e.traced) || has(S, "startSecondary", (e) => e.ch === ch && e.traced) }),
  noBasic: { text: "Use the Guardrails library (never Basic Infusion)", check: (S) => !has(S, "basicInfusion") && (has(S, "start") || has(S, "startSecondary")), negative: (S) => has(S, "basicInfusion") },
  running: (ch) => ({ text: `Channel ${ch} infusing with the roller clamp open`, check: (S) => chan(S, ch).state === "running" && chan(S, ch).bedside.clampOpen }),
};

const SCENARIOS = [
  // ------------------------------------------------------------------ PRACTICE MODE
  {
    id: "practice", level: "Practice mode", title: "Random orders: program the pump", practice: true,
    summary: "A new order every round from Med-Surg, ICU, L&D or Pediatrics. Lines are already primed and loaded: just program the pump and press START.",
    setup: () => {},
  },
  // ------------------------------------------------------------------
  {
    id: "free", level: "Open", title: "Free practice",
    summary: "Explore every screen with no order to follow.",
    patient: null,
    setup: (P) => P.reset(),
    order: () => `<p>No order. Try each feature: start-up, a Guardrails drug, a weight-based drip, a secondary, a soft-limit override, a hard limit, and the bedside actions that cause alarms.</p>`,
    bags: [
      { name: "0.9% Sodium Chloride 1000 mL", vol: 1000 },
      { name: "Lactated Ringer's 1000 mL", vol: 1000 },
      { name: "Heparin 25,000 units / 250 mL", vol: 250 },
      { name: "Norepinephrine 4 mg / 250 mL", vol: 250 },
      { name: "Cefazolin 2 g / 100 mL (secondary)", vol: 100, secondary: true },
      { name: "Vancomycin 1 g / 250 mL (secondary)", vol: 250, secondary: true },
    ],
    goals: [],
    hints: ["Press SYSTEM ON to begin.", "Use the Bedside panel to prime and load tubing before pressing START."],
  },

  // ------------------------------------------------------------------ LEVEL 1
  {
    id: "l1-jones-kvo", level: "Level 1", title: "Charles Jones · Pump start-up, NS at KVO",
    summary: "First program from power-on. CHF patient with a fluid-restricted KVO line.",
    patient: { mrn: "104220", name: "Charles Jones", age: "68 y", weight: "82 kg", allergies: "NKDA", dx: "Congestive heart failure", unit: "Med-Surg", source: "Level 1 ATU Simulation Hospital" },
    setup: (P) => P.reset(),
    order: () => `<p><b>IV: normal saline at KVO</b> <span class="src">(admission orders)</span></p>
      <p class="policy">Unit policy (sim extension): adult KVO rate = <b>10 mL/hr</b>. Bag on hand: 0.9% Sodium Chloride <b>500 mL</b>.</p>`,
    bags: [{ name: "0.9% Sodium Chloride 500 mL", vol: 500 }],
    goals: [
      G.newPatient, G.profile("medsurg"), G.patientId("104220"), G.primeLoad("A"),
      { text: "Select <b>Sodium Chloride 0.9%</b>, <b>500 mL</b> bag, from Guardrails", check: (S) => has(S, "start", (e) => e.drugId === "ns" && e.concVol === 500) },
      { text: "Rate <b>10 mL/h</b>, VTBI <b>500 mL</b>", check: (S) => has(S, "start", (e) => e.drugId === "ns" && near(e.rate, 10) && near(e.vtbi, 500)) },
      G.traced("A"), G.running("A"),
    ],
    hints: [
      "SYSTEM ON → watch the self test → New Patient: Yes → Adult Med-Surg → Yes → type the patient ID → CONFIRM.",
      "Bedside panel: Spike & prime, then Load set in Channel A.",
      "Press CHANNEL SELECT on module A (left of the PC unit) → Guardrails IV Fluids → Sodium Chloride 0.9% → 500 mL → Yes.",
      "Press the RATE soft key, type 10. Press VTBI, type 500.",
      "Before START: Trace line, open the roller clamp. Then press the START soft key under the screen.",
    ],
    debrief: `<p>Mr. Jones is in heart failure and receiving IV furosemide. A KVO rate keeps the vein open without adding volume. Check I&amp;O and daily weight, and remember IV furosemide is given IV push, not through the pump.</p>`,
  },
  {
    id: "l1-jones-kcl", level: "Level 1", title: "Charles Jones · Potassium rider and a hard limit",
    summary: "An unsafe KCl order meets a Guardrails hard limit.",
    patient: { mrn: "104220", name: "Charles Jones", age: "68 y", weight: "82 kg", allergies: "NKDA", dx: "CHF on IV furosemide", unit: "Med-Surg (peripheral IV)", source: "Level 1 ATU Simulation Hospital" },
    setup: (P) => P.preset({ patientId: "104220", profile: "medsurg", weight: 82, channels: [{ ch: "A", drugId: "ns", concIdx: 1, rate: 10, vtbi: 500, remaining: 380, bag: 380, bagName: "0.9% Sodium Chloride 500 mL" }] }),
    order: (S, X) => X.decisions.kcl === "clarify"
      ? `<p class="struck">Potassium chloride 20 mEq in 100 mL IVPB, infuse over 30 minutes</p>
         <p><b>Clarified order (RBTO):</b> Potassium chloride <b>20 mEq / 100 mL</b> IVPB, infuse over <b>2 hours</b> as a secondary.</p>`
      : `<p class="ext">Sim extension: AM potassium 3.1 mEq/L after diuresis.</p>
         <p><b>Potassium chloride 20 mEq in 100 mL IVPB, infuse over 30 minutes.</b></p>
         <p class="policy">Patient has a peripheral IV. Bag on hand: KCl 20 mEq / 100 mL.</p>`,
    bags: [{ name: "Potassium Chloride 20 mEq / 100 mL (secondary)", vol: 100, secondary: true }],
    decisions: [{
      id: "kcl", when: (S) => has(S, "hardLimit", (e) => e.drugId === "kcl"),
      prompt: "The pump will not accept this rate. What do you do?",
      options: [
        { id: "basic", label: "Reprogram it as a Basic Infusion so it runs", correct: false, feedback: "Never bypass a hard limit with Basic Infusion. 40 mEq/hr through a peripheral IV can cause fatal arrhythmias." },
        { id: "clarify", label: "Hold the dose and call the provider to clarify", correct: true, feedback: "Correct. Peripheral KCl is limited to 10 mEq/hr. The provider changes the order to infuse over 2 hours." },
        { id: "push", label: "Give it faster through the primary line port", correct: false, feedback: "KCl is never given IV push or as a rapid bolus." },
      ],
    }],
    goals: [
      { text: "Try the order as written (20 mEq over 30 min) and meet the <b>hard limit</b>", check: (S) => has(S, "hardLimit", (e) => e.drugId === "kcl") },
      { text: "Choose the safe action at the hard limit", check: (S, X) => X.decisions.kcl === "clarify", negative: (S, X) => X.decisions.kcl && X.decisions.kcl !== "clarify" },
      { text: "Hang the KCl bag above the primary and open its clamp", check: (S) => chan(S, "A").bedside.secondaryHung && chan(S, "A").bedside.secondaryClampOpen },
      { text: "Run as a <b>secondary</b>: KCl 20 mEq/100 mL at <b>10 mEq/hr = 50 mL/h</b>, VTBI 100", check: (S) => has(S, "startSecondary", (e) => e.drugId === "kcl" && near(e.rate, 50) && near(e.vtbi, 100)) },
      G.noBasic,
    ],
    hints: [
      "CHANNEL SELECT A → SECONDARY soft key → Potassium Chloride → 20 mEq/100 mL → Yes → CONFIRM → NEXT.",
      "Enter the order as written: 20 mEq in 30 min = DOSE 40 mEq/hr. Press START and watch the pump respond.",
      "After clarification: 20 mEq over 2 h = DOSE 10 mEq/hr (50 mL/h). VTBI is already 100 mL.",
    ],
    debrief: `<p>A hard limit is the library telling you the dose is unsafe for this care area. It cannot be overridden. Hold, clarify with the provider or pharmacist, and document. Peripheral potassium: max 10 mEq/hr.</p>`,
  },
  {
    id: "l1-lin-secondary", level: "Level 1", title: "Sara Lin · Ceftriaxone secondary, then a rate change",
    summary: "Hang an IVPB as a secondary and reduce maintenance fluids.",
    patient: { mrn: "118804", name: "Sara Lin", age: "18 y", weight: "56 kg", allergies: "NKDA", dx: "Ruptured appendix, s/p open appendectomy", unit: "Med-Surg", source: "Level 1 ATU Simulation Hospital" },
    setup: (P) => P.preset({ patientId: "118804", profile: "medsurg", weight: 56, channels: [{ ch: "A", drugId: "d5ns", rate: 125, vtbi: 1000, remaining: 640, bag: 640, bagName: "D5 0.9% NaCl 1000 mL" }] }),
    order: (S, X) => `<p><b>D5 NS @ 125 mL/hr</b>, decrease to <b>30 mL/hr</b> when taking oral fluids.</p>
      <p><b>Ceftriaxone 1 g IV q 12 hours</b> <span class="src">(pharmacy: 1 g / 50 mL, infuse over 30 min)</span></p>
      ${X.phase >= 1 ? `<p class="new">Update: Sara is now drinking clear liquids without nausea.</p>` : ""}`,
    bags: [{ name: "Ceftriaxone 1 g / 50 mL (secondary)", vol: 50, secondary: true }, { name: "D5 0.9% NaCl 1000 mL", vol: 1000 }],
    tick: (S, X) => { if (X.phase === 0 && has(S, "secondaryComplete", (e) => e.ch === "A")) X.phase = 1; },
    goals: [
      { text: "Hang ceftriaxone <b>above</b> the primary and open the secondary clamp", check: (S) => has(S, "startSecondary", (e) => e.hung && e.clamp) },
      { text: "Secondary via Guardrails: <b>Ceftriaxone 1 g/50 mL</b>", check: (S) => has(S, "startSecondary", (e) => e.drugId === "ceftriaxone") },
      { text: "Secondary rate <b>100 mL/h</b>, VTBI <b>50 mL</b> (30 min)", check: (S) => has(S, "startSecondary", (e) => e.drugId === "ceftriaxone" && near(e.rate, 100) && near(e.vtbi, 50)) },
      { text: "Secondary actually infused from the ceftriaxone bag", check: (S) => has(S, "secondaryComplete", (e) => e.fromPrimary < 1), negative: (S) => has(S, "secondaryComplete", (e) => e.fromPrimary >= 1) },
      { text: "After the secondary, decrease D5NS to <b>30 mL/h</b>", check: (S) => has(S, "titrate", (e) => e.ch === "A" && near(e.toRate, 30)) },
    ],
    hints: [
      "Bedside: Hang secondary bag above primary, then Open secondary clamp.",
      "CHANNEL SELECT A → SECONDARY soft key → Ceftriaxone → Yes.",
      "VTBI is pre-filled with 50 mL. DURATION is selected: type 30 (0:30). Rate becomes 100 mL/h. Press START.",
      "Speed up sim time to finish the secondary. Then CHANNEL SELECT A → RATE → 30 → START.",
    ],
    debrief: `<p>If the secondary clamp stays closed or the bag hangs level with the primary, the pump pulls from the primary bag at the secondary rate. The patient gets 100 mL/h of D5NS and no antibiotic, and the pump shows no alarm.</p>`,
  },

  // ------------------------------------------------------------------ LEVEL 2
  {
    id: "l2-fowler", level: "Level 2", title: "Jane Fowler · LR primary and pre-op cefazolin",
    summary: "Full workflow from power-on: primary plus secondary.",
    patient: { mrn: "220417", name: "Jane Fowler", age: "Adult", weight: "per chart", allergies: "See chart", dx: "Pre-op, surgical unit", unit: "Surgical", source: "Level 2 ATU OB Simulation Hospital" },
    setup: (P) => P.reset(),
    order: () => `<p><b>IV fluids: Lactated Ringers at 125 mL/hr</b></p><p><b>Cefazolin 2 grams IV x 1 on call to OR</b> <span class="src">(pharmacy: 2 g / 100 mL, over 30 min)</span></p>`,
    bags: [{ name: "Lactated Ringer's 1000 mL", vol: 1000 }, { name: "Cefazolin 2 g / 100 mL (secondary)", vol: 100, secondary: true }],
    goals: [
      G.newPatient, G.profile("medsurg"), G.patientId("220417"), G.primeLoad("A"),
      { text: "Primary: <b>Lactated Ringer's 125 mL/h</b>, VTBI 1000", check: (S) => has(S, "start", (e) => e.drugId === "lr" && near(e.rate, 125) && near(e.vtbi, 1000)) },
      G.traced("A"),
      { text: "Secondary: <b>Cefazolin 2 g/100 mL at 200 mL/h</b>, VTBI 100", check: (S) => has(S, "startSecondary", (e) => e.drugId === "cefazolin" && e.concVol === 100 && near(e.rate, 200) && near(e.vtbi, 100)) },
      { text: "Secondary bag hung high with clamp open when started", check: (S) => has(S, "startSecondary", (e) => e.drugId === "cefazolin" && e.hung && e.clamp) },
      G.noBasic,
    ],
    hints: ["Start LR first: CHANNEL SELECT A → Guardrails IV Fluids → Lactated Ringer's.", "Then CHANNEL SELECT A → SECONDARY. Cefazolin has two concentrations: pick 2 g/100 mL.", "VTBI is pre-filled with 100 mL. Type 30 for DURATION (0:30) → 200 mL/h."],
    debrief: `<p>Pre-op antibiotics are timed to the incision. Program the secondary, confirm the callback setting, and document the start time.</p>`,
  },
  {
    id: "l2-sung-oxytocin", level: "Level 2", title: "Amelia Sung · Oxytocin induction titration",
    summary: "milliunits/min dosing, titration, and responding to tachysystole.",
    patient: { mrn: "231906", name: "Amelia Sung", age: "Adult", weight: "per chart", allergies: "See chart", dx: "Active labor, gestational diabetes", unit: "Labor & Delivery", source: "Level 2 ATU OB Simulation Hospital" },
    setup: (P) => P.preset({ patientId: "231906", profile: "ld", channels: [{ ch: "A", drugId: "lr", rate: 125, vtbi: 1000, remaining: 820, bag: 820, bagName: "Lactated Ringer's 1000 mL" }] }),
    order: (S, X) => `<p><b>Lactated Ringer @ 125 mL/hr</b> (running on Channel A)</p>
      <p><b>Oxytocin 30 units in 500 mL 0.9% sodium chloride.</b> Start at <b>2 mU/min</b>, increase by 2 mU every 15 min until contractions every 2–3 min.</p>
      <p class="policy">Program oxytocin on <b>Channel B</b> and connect at the port closest to the patient.</p>
      ${X.phase === 2 ? `<p class="new">15 min later: contractions every 5–6 min, FHR baseline 140, moderate variability. Increase per protocol.</p>` : ""}
      ${X.phase >= 3 ? `<p class="new alert">Contractions now every 90 seconds, lasting 90 seconds (tachysystole). FHR 150 with minimal variability.</p>` : ""}`,
    bags: [{ name: "Oxytocin 30 units / 500 mL NS", vol: 500 }],
    tick: (S, X) => {
      if (X.phase === 0 && has(S, "start", (e) => e.drugId === "oxytocin")) { X.phase = 1; X.t1 = S.t; }
      if (X.phase === 1 && S.t - X.t1 >= 900) X.phase = 2;
      if (X.phase === 2 && has(S, "titrate", (e) => e.drugId === "oxytocin" && near(e.toDose, 4))) { X.phase = 3; X.t3 = S.t; }
    },
    vitals: (S, X) => X.phase >= 3 ? { "Contractions": "q 90 sec", FHR: "150, min var" } : X.phase === 2 ? { "Contractions": "q 5–6 min", FHR: "140" } : { FHR: "140" },
    goals: [
      G.primeLoad("B"),
      { text: "Oxytocin <b>INDUCTION</b> entry on Channel B", check: (S) => has(S, "start", (e) => e.drugId === "oxytocin" && e.ch === "B") },
      { text: "Start at <b>2 mU/min = 2 mL/h</b>, VTBI 500", check: (S) => has(S, "start", (e) => e.drugId === "oxytocin" && near(e.dose, 2) && near(e.rate, 2) && near(e.vtbi, 500)) },
      { text: "At 15 min, titrate to <b>4 mU/min</b> (4 mL/h)", check: (S) => has(S, "titrate", (e) => e.drugId === "oxytocin" && near(e.toDose, 4)) },
      { text: "Tachysystole: <b>PAUSE</b> the oxytocin channel", check: (S, X) => X.phase >= 3 && has(S, "pause", (e) => e.ch === "B" && e.t >= X.t3) },
    ],
    hints: [
      "Bedside Channel B: Spike & prime the oxytocin bag, load set, trace, open clamp.",
      "Module B is on the right of the PC unit: CHANNEL SELECT → Guardrails Drugs → Oxytocin INDUCTION → Yes → CONFIRM → NEXT.",
      "30 units/500 mL = 60 mU/mL. DOSE 2 mU/min → 2 mL/h. VTBI 500.",
      "At the 15-minute mark: CHANNEL SELECT B → DOSE → 4 → START.",
      "With tachysystole, press PAUSE on module B, reposition, give an IV fluid bolus per protocol and notify the provider.",
    ],
    debrief: `<p>Oxytocin is a high-alert medication. It runs on its own pump channel as a piggyback so it can be stopped without stopping the main line.</p>`,
  },
  {
    id: "l2-sanogo-pp", level: "Level 2", title: "Fatima Sanogo · Postpartum oxytocin, two-step rate",
    summary: "Pick the right oxytocin entry and use VTBI to step the rate down.",
    patient: { mrn: "238812", name: "Fatima Sanogo", age: "Adult", weight: "per chart", allergies: "See chart", dx: "Postpartum, placenta delivered", unit: "Labor & Delivery / Postpartum", source: "Level 2 ATU OB Simulation Hospital" },
    setup: (P) => P.reset(),
    order: () => `<p><b>Pitocin 30 units added to 500 mL Normal Saline to infuse at 334 mL/hr after delivery of placenta for 100 mL, then decrease rate to 95 mL/hr until bag is complete.</b></p>`,
    bags: [{ name: "Oxytocin 30 units / 500 mL NS", vol: 500 }],
    goals: [
      G.newPatient, G.profile("ld"), G.patientId("238812"), G.primeLoad("A"),
      { text: "Use <b>Oxytocin POSTPARTUM</b> (not INDUCTION)", check: (S) => has(S, "start", (e) => e.drugId === "oxytocinPP"), negative: (S) => has(S, "start", (e) => e.drugId === "oxytocin") },
      { text: "Step 1: <b>334 mL/h</b>, VTBI <b>100 mL</b>", check: (S) => has(S, "start", (e) => e.drugId === "oxytocinPP" && near(e.rate, 334) && near(e.vtbi, 100)) },
      { text: "Step 2 (after VTBI complete): <b>95 mL/h</b>, VTBI <b>400 mL</b>", check: (S) => has(S, "newVtbi", (e) => near(e.rate, 95) && near(e.vtbi, 400)) },
    ],
    hints: [
      "Profile: Labor & Delivery / Postpartum. Oxytocin POSTPARTUM is under Guardrails Drugs (P-T).",
      "RATE 334, VTBI 100. The pump alarms INFUSION COMPLETE when the first step is done.",
      "Then CHANNEL SELECT A → RATE 95, VTBI 400 (500 − 100) → START.",
    ],
    debrief: `<p>Libraries carry separate induction and postpartum oxytocin entries with very different limits. Choosing the wrong one triggers a hard limit or, worse, lets a wrong dose run.</p>`,
  },
  {
    id: "l2-thomas-bolus", level: "Level 2", title: "Molly Thomas · Pediatric 20 mL/kg bolus",
    summary: "Calculate a weight-based bolus and set the VTBI to the dose, not the bag.",
    patient: { mrn: "240705", name: "Molly Thomas", age: "7 months", weight: "7 kg", allergies: "See chart", dx: "Croup, decreased oral intake", unit: "Pediatrics", source: "Level 2 ATU OB Simulation Hospital" },
    setup: (P) => P.reset(),
    order: () => `<p><b>IV: NS bolus 20 mL/kg to infuse over 30 mins.</b></p><p class="policy">Bag on hand: 0.9% Sodium Chloride <b>250 mL</b>.</p>`,
    bags: [{ name: "0.9% Sodium Chloride 250 mL", vol: 250 }],
    goals: [
      G.newPatient, G.profile("peds"), G.patientId("240705"), G.primeLoad("A"),
      { text: "Use the <b>NS BOLUS</b> entry", check: (S) => has(S, "start", (e) => e.drugId === "nsBolus") },
      { text: "VTBI <b>140 mL</b> (20 mL × 7 kg), not the whole 250 mL bag", check: (S) => has(S, "start", (e) => e.drugId === "nsBolus" && near(e.vtbi, 140)), negative: (S) => has(S, "start", (e) => near(e.vtbi, 250)) },
      { text: "Rate <b>280 mL/h</b> (140 mL over 30 min)", check: (S) => has(S, "start", (e) => e.drugId === "nsBolus" && near(e.rate, 280)) },
      G.traced("A"),
    ],
    hints: ["20 mL/kg × 7 kg = 140 mL.", "Guardrails IV Fluids → Sodium Chloride 0.9% BOLUS. Press VOLUME DURATION, then VTBI 140 and DURATION 30. The pump calculates 280 mL/h.", "The maintenance NS entry has a peds hard max of 250 mL/h. The bolus entry allows up to 500."],
    debrief: `<p>In pediatrics the VTBI protects the child. Setting VTBI to the bag volume would give 250 mL (36 mL/kg) if nobody stops it.</p>`,
  },
  {
    id: "l2-smith-blood", level: "Level 2", title: "Stephanie Smith · PRBC with maintenance fluids",
    summary: "Set up a blood transfusion on its own channel with the right priming fluid.",
    patient: { mrn: "245535", name: "Stephanie Smith", age: "Adolescent", weight: "53.5 kg", allergies: "See chart", dx: "Sickle cell crisis", unit: "Pediatrics", source: "Level 2 ATU OB Simulation Hospital" },
    setup: (P) => P.preset({ patientId: "245535", profile: "peds", weight: 53.5, channels: [{ ch: "A", drugId: "d5halfns", rate: 150, vtbi: 1000, remaining: 700, bag: 700, bagName: "D5 1/2 NS 1000 mL" }] }),
    order: () => `<p><b>IV: D5 1/2 NS @ 150 mL/hr</b> (Channel A)</p><p><b>2 U Blood infused over 2 hours</b> <span class="src">(sim: each unit 300 mL over 2 h)</span></p>`,
    bags: [{ name: "PRBC unit 1 — 300 mL", vol: 300 }, { name: "0.9% NaCl 250 mL (blood set prime)", vol: 250 }],
    decisions: [{
      id: "prime", when: () => true,
      prompt: "Which solution do you use to prime the blood tubing on Channel B?",
      options: [
        { id: "ns", label: "0.9% Sodium Chloride", correct: true, feedback: "Correct. Normal saline is the only solution compatible with red cells." },
        { id: "d5", label: "D5 1/2 NS already running", correct: false, feedback: "Dextrose causes red cells to clump and hemolyze." },
        { id: "lr", label: "Lactated Ringer's", correct: false, feedback: "Calcium in LR can trigger clotting in the blood tubing." },
      ],
    }],
    goals: [
      { text: "Prime blood tubing with the compatible solution", check: (S, X) => X.decisions.prime === "ns", negative: (S, X) => X.decisions.prime && X.decisions.prime !== "ns" },
      G.primeLoad("B"),
      { text: "Channel B: <b>Packed Red Blood Cells</b> from Guardrails", check: (S) => has(S, "start", (e) => e.ch === "B" && e.drugId === "prbc") },
      { text: "Rate <b>150 mL/h</b>, VTBI <b>300 mL</b>", check: (S) => has(S, "start", (e) => e.drugId === "prbc" && near(e.rate, 150) && near(e.vtbi, 300)) },
      G.traced("B"),
    ],
    hints: ["Answer the priming question first.", "CHANNEL SELECT B → Guardrails IV Fluids → Packed Red Blood Cells → 300 mL.", "300 mL over 2 h = RATE 150 mL/h, VTBI 300.", "Stay with the patient for the first 15 minutes and take vitals per policy."],
    debrief: `<p>Two-person verification at the bedside, NS-only priming, and complete each unit within 4 hours of spiking. Some facilities start blood slowly for 15 min; follow policy.</p>`,
  },

  // ------------------------------------------------------------------ LEVEL 3
  {
    id: "l3-watkins-heparin", level: "Level 3", title: "Vernon Watkins · Nurse-driven heparin protocol",
    summary: "Weight-based high-alert drip with a bolus from the vial and a protocol titration.",
    patient: { mrn: "300409", name: "Vernon Watkins", age: "Adult", weight: "80 kg (dosing weight)", allergies: "See chart", dx: "POD 4 hemicolectomy, suspected PE", unit: "Med-Surg", source: "Level 3 ATU Simulation Hospital" },
    setup: (P) => P.reset(),
    order: (S, X) => `<p><b>Using weight of 80 kg: initiate Nurse Driven Heparin Protocol.</b></p>
      <p><b>Please give bolus from the Heparin 10,000 units/10 mL vial, and use the bag for the drip.</b></p>
      <p class="policy">Protocol values used here (confirm against the chart's protocol PDF): bolus 80 units/kg; infusion start <b>18 units/kg/hr</b>. Bag: Heparin 25,000 units / 250 mL.</p>
      ${X.phase >= 1 ? `<p class="new">6-hour aPTT is subtherapeutic. Protocol: <b>increase infusion by 2 units/kg/hr</b>.</p>` : ""}`,
    bags: [{ name: "Heparin 25,000 units / 250 mL", vol: 250 }],
    decisions: [{
      id: "bolus", when: () => true,
      prompt: "How is the 6,400-unit bolus (80 units/kg × 80 kg) given?",
      options: [
        { id: "vial", label: "IV push from the 10,000 units/10 mL vial: 6.4 mL", correct: true, feedback: "Correct. The order says to bolus from the vial and use the bag only for the drip." },
        { id: "bag", label: "Pump bolus from the drip bag", correct: false, feedback: "Not per this order. Bag boluses are only used when the order and library allow it." },
        { id: "skip", label: "Skip the bolus and start the drip", correct: false, feedback: "The protocol calls for a bolus to reach a therapeutic level quickly." },
      ],
    }, {
      id: "check", when: () => true,
      prompt: "Heparin is high alert. What happens before you press START?",
      options: [
        { id: "idc", label: "Independent double check with a second RN", correct: true, feedback: "Correct. The second RN checks the order, weight, concentration, dose and rate independently." },
        { id: "none", label: "Nothing extra: Guardrails already checked it", correct: false, feedback: "Guardrails does not catch a wrong weight or wrong concentration choice." },
      ],
    }],
    tick: (S, X) => { if (X.phase === 0 && has(S, "start", (e) => e.drugId === "heparin")) X.phase = 1; },
    goals: [
      G.newPatient, G.profile("medsurg"), G.patientId("300409"),
      { text: "Answer both heparin safety questions correctly", check: (S, X) => X.decisions.bolus === "vial" && X.decisions.check === "idc", negative: (S, X) => (X.decisions.bolus && X.decisions.bolus !== "vial") || (X.decisions.check && X.decisions.check !== "idc") },
      { text: "Heparin <b>25,000 units / 250 mL</b> (100 units/mL)", check: (S) => has(S, "start", (e) => e.drugId === "heparin" && e.concVol === 250), negative: (S) => has(S, "start", (e) => e.drugId === "heparin" && e.concVol === 500) },
      { text: "Weight <b>80 kg</b>, dose <b>18 units/kg/hr</b> → <b>14.4 mL/h</b>", check: (S) => has(S, "start", (e) => e.drugId === "heparin" && near(e.weight, 80) && near(e.dose, 18) && near(e.rate, 14.4)) },
      { text: "VTBI <b>250 mL</b>, no overrides", check: (S) => has(S, "start", (e) => e.drugId === "heparin" && near(e.vtbi, 250) && e.overrides === 0) },
      G.traced("A"),
      { text: "Protocol change: titrate to <b>20 units/kg/hr (16 mL/h)</b>", check: (S) => has(S, "titrate", (e) => e.drugId === "heparin" && near(e.toDose, 20) && near(e.toRate, 16)) },
    ],
    hints: [
      "Guardrails Drugs → Heparin → 25,000 units/250 mL → Yes → CONFIRM (advisory).",
      "Drug Setup: press PATIENT WEIGHT, type 80, CONFIRM, then NEXT.",
      "DOSE 18 → rate 14.4 mL/h (18 × 80 ÷ 100). VTBI 250. START.",
      "Titrate: CHANNEL SELECT A → DOSE → 20 → START. The rate becomes 16 mL/h.",
    ],
    debrief: `<p>Always titrate by <b>dose</b>, not by rate, so Guardrails can check the new dose. Record each change on the heparin flowsheet with both RN initials.</p>`,
  },
  {
    id: "l3-livingston-pressor", level: "Level 3", title: "Ruth Livingston · Fluid bolus, then norepinephrine",
    summary: "Discontinue a line, run a bolus at the pump maximum, start and titrate a vasopressor.",
    patient: { mrn: "301008", name: "Ruth Livingston", age: "80 y", weight: "per chart", allergies: "None", dx: "POD 5 ORIF R hip, hypotension; transferred to ICU", unit: "ICU", source: "Level 3 ATU Simulation Hospital" },
    setup: (P) => P.preset({ patientId: "301008", profile: "icu", channels: [{ ch: "A", drugId: "lr", rate: 75, vtbi: 1000, remaining: 450, bag: 450, bagName: "Lactated Ringer's 1000 mL" }] }),
    order: (S, X) => `<p>20. <b>DC Lactated Ringers IV @ 75 mL/hr</b></p>
      <p>10. <b>Normal saline bolus 500 mL over 30 min stat</b></p>
      <p>11. After fluid bolus if MAP &lt; 65 or SBP &lt; 100 start: <b>Norepinephrine @ 2 mcg/min</b>, titrate by 2 mcg q 5 min to maintain MAP &gt; 65 or SBP &gt; 100. Max 30 mcg/min.</p>
      <p>23. NS @ 125 mL/hr after bolus completed</p>
      <p class="policy">Bags: NS 500 mL (bolus), Norepinephrine 4 mg / 250 mL, NS 1000 mL.</p>
      ${X.phase >= 1 ? `<p class="new alert">Bolus complete. BP 88/50, MAP 63.</p>` : ""}
      ${X.phase >= 3 ? `<p class="new alert">5 min on norepinephrine: BP 92/52, MAP 64.</p>` : ""}
      ${X.phase >= 4 ? `<p class="new">BP 104/60, MAP 75. At goal.</p>` : ""}`,
    bags: [{ name: "0.9% NaCl 500 mL (bolus)", vol: 500 }, { name: "Norepinephrine 4 mg / 250 mL", vol: 250 }, { name: "0.9% NaCl 1000 mL", vol: 1000 }],
    tick: (S, X) => {
      if (X.phase === 0 && has(S, "complete", (e) => e.ch !== undefined) && has(S, "start", (e) => e.drugId === "nsBolus")) X.phase = 1;
      if (X.phase === 1 && has(S, "start", (e) => e.drugId === "norepinephrine")) { X.phase = 2; X.t2 = S.t; }
      if (X.phase === 2 && S.t - X.t2 >= 300) X.phase = 3;
      if (X.phase === 3 && has(S, "titrate", (e) => e.drugId === "norepinephrine" && near(e.toDose, 4))) X.phase = 4;
    },
    vitals: (S, X) => [{ BP: "86/48", MAP: 61, HR: 112 }, { BP: "88/50", MAP: 63, HR: 108 }, { BP: "88/50", MAP: 63, HR: 108 }, { BP: "92/52", MAP: 64, HR: 104 }, { BP: "104/60", MAP: 75, HR: 96 }][Math.min(X.phase, 4)],
    goals: [
      { text: "Stop LR: pause Channel A and turn it off", check: (S) => has(S, "channelOff", (e) => e.ch === "A") },
      { text: "NS BOLUS 500 mL at the pump max (<b>999 mL/h</b>), VTBI 500", check: (S) => has(S, "start", (e) => e.drugId === "nsBolus" && e.rate >= 900 && near(e.vtbi, 500)) },
      { text: "Norepinephrine <b>4 mg/250 mL</b> at <b>2 mcg/min = 7.5 mL/h</b>", check: (S) => has(S, "start", (e) => e.drugId === "norepinephrine" && e.concAmt === 4 && near(e.dose, 2) && near(e.rate, 7.5)) },
      { text: "After 5 min with MAP &lt; 65: titrate to <b>4 mcg/min (15 mL/h)</b>", check: (S) => has(S, "titrate", (e) => e.drugId === "norepinephrine" && near(e.toDose, 4) && near(e.toRate, 15)) },
      { text: "NS maintenance at <b>125 mL/h</b> (Sodium Chloride 0.9% entry)", check: (S) => has(S, "start", (e) => e.drugId === "ns" && near(e.rate, 125)) },
      G.noBasic,
    ],
    hints: [
      "Module A: PAUSE → CHANNEL OFF → Yes. Prime and load Channel B for the bolus.",
      "Guardrails IV Fluids → NS BOLUS. 500 mL in 30 min = 1000 mL/h, above the 999 mL/h pump maximum. Program RATE 999, VTBI 500.",
      "Norepinephrine 4 mg/250 mL = 16 mcg/mL. DOSE 2 mcg/min → 7.5 mL/h.",
      "When the bolus finishes: PAUSE and CHANNEL OFF on B, hang NS 1000 mL, program Sodium Chloride 0.9% at 125 mL/h.",
    ],
    debrief: `<p>Titrate vasopressors by dose and reassess MAP after each change. Use a central line when possible and watch the IV site for extravasation.</p>`,
  },
  {
    id: "l3-shapiro-ntg", level: "Level 3", title: "Carl Shapiro · IV nitroglycerin for chest pain",
    summary: "New drip on a second channel with titration to pain and blood pressure.",
    patient: { mrn: "300719", name: "Carl Shapiro", age: "Adult", weight: "per chart", allergies: "See chart", dx: "ACS, progressive care", unit: "Progressive Care (ICU/PCU profile)", source: "Level 3 ATU Simulation Hospital" },
    setup: (P) => P.preset({ patientId: "300719", profile: "icu", channels: [{ ch: "A", drugId: "ns", rate: 25, vtbi: 1000, remaining: 900, bag: 900, bagName: "0.9% NaCl 1000 mL" }] }),
    order: (S, X) => `<p><b>IV: Normal saline at 25 mL/hr</b> (Channel A)</p>
      <p>Nitroglycerin 0.4 mg SL PRN chest pain and notify provider to evaluate for IV nitroglycerin.</p>
      <p class="new">Sim extension: chest pain 7/10 after 2 SL doses. <b>New order: Nitroglycerin 50 mg / 250 mL, start 5 mcg/min, titrate by 5 mcg/min q 5 min for chest pain. Hold for SBP &lt; 90.</b></p>
      ${X.phase >= 2 ? `<p class="new alert">5 min later: chest pain 5/10, BP 138/84.</p>` : ""}
      ${X.phase >= 3 ? `<p class="new">Chest pain 2/10, BP 126/78.</p>` : ""}`,
    bags: [{ name: "Nitroglycerin 50 mg / 250 mL (glass/non-PVC)", vol: 250 }],
    tick: (S, X) => {
      if (X.phase === 0 && has(S, "start", (e) => e.drugId === "nitroglycerin")) { X.phase = 1; X.t1 = S.t; }
      if (X.phase === 1 && S.t - X.t1 >= 300) X.phase = 2;
      if (X.phase === 2 && has(S, "titrate", (e) => e.drugId === "nitroglycerin" && near(e.toDose, 10))) X.phase = 3;
    },
    vitals: (S, X) => [{ BP: "146/88", HR: 96, Pain: "7/10" }, { BP: "146/88", HR: 96, Pain: "7/10" }, { BP: "138/84", HR: 90, Pain: "5/10" }, { BP: "126/78", HR: 84, Pain: "2/10" }][Math.min(X.phase, 3)],
    goals: [
      G.primeLoad("B"),
      { text: "Nitroglycerin on <b>Channel B</b> at <b>5 mcg/min = 1.5 mL/h</b>, VTBI 250", check: (S) => has(S, "start", (e) => e.ch === "B" && e.drugId === "nitroglycerin" && near(e.dose, 5) && near(e.rate, 1.5) && near(e.vtbi, 250)) },
      G.traced("B"),
      { text: "Titrate to <b>10 mcg/min (3 mL/h)</b> after 5 min", check: (S) => has(S, "titrate", (e) => e.drugId === "nitroglycerin" && near(e.toDose, 10) && near(e.toRate, 3)) },
      G.noBasic,
    ],
    hints: ["Module B (right): CHANNEL SELECT → Guardrails Drugs → Nitroglycerin → Yes → NEXT.", "50 mg/250 mL = 200 mcg/mL. DOSE 5 mcg/min → 1.5 mL/h. VTBI 250.", "Speed up time 5 minutes, reassess, then CHANNEL SELECT B → DOSE 10 → START."],
    debrief: `<p>Check BP before every titration and hold for SBP &lt; 90. Nitroglycerin is used with non-PVC tubing to limit drug absorption.</p>`,
  },
  {
    id: "l3-brody-alarms", level: "Level 3", title: "Vincent Brody · Alarm troubleshooting",
    summary: "Respond to occlusion, air-in-line and infusion-complete alarms.",
    patient: { mrn: "300628", name: "Vincent Brody", age: "Adult", weight: "per chart", allergies: "See chart", dx: "Medical admission, respiratory", unit: "Med-Surg", source: "Level 3 ATU Simulation Hospital" },
    setup: (P) => P.preset({ patientId: "300628", profile: "medsurg", channels: [{ ch: "A", drugId: "d5halfnsk", rate: 50, vtbi: 1000, remaining: 12, bag: 60, bagName: "D5 1/2 NS + KCl 20 mEq/L 1000 mL" }] }),
    order: () => `<p><b>IV: D5 1/2 NS with 20 mEq KCl @ 50 mL/hr</b></p><p class="policy">Infusion is running. Keep it running through whatever the shift brings. A new 1000 mL bag is available.</p>`,
    bags: [{ name: "D5 1/2 NS + KCl 20 mEq/L 1000 mL", vol: 1000 }],
    tick: (S, X, P) => {
      const ch = chan(S, "A");
      if (X.phase === 0 && S.t > 20) { ch.bedside.occluded = true; X.phase = 1; }
      if (X.phase === 1 && has(S, "resume", (e) => e.fromAlarm === "patientOcc") && ch.state === "running") { X.phase = 2; X.t2 = S.t; }
      if (X.phase === 2 && S.t - X.t2 > 30) { ch.bedside.air = true; X.phase = 3; }
    },
    goals: [
      { text: "Patient-side occlusion: silence, check site/straighten line, press RESTART", check: (S) => has(S, "resume", (e) => e.fromAlarm === "patientOcc") },
      { text: "Air in line: pause, clear the air, press RESTART", check: (S) => has(S, "resume", (e) => e.fromAlarm === "air") },
      { text: "Infusion complete: hang a new bag and program VTBI <b>1000 mL</b> at 50 mL/h", check: (S) => has(S, "newVtbi", (e) => near(e.vtbi, 1000) && near(e.rate, 50)) },
      { text: "Silence alarms while you troubleshoot", check: (S) => has(S, "silence") },
    ],
    hints: [
      "Alarm message shows on the PC screen and flashes on the module.",
      "Occlusion: SILENCE, Bedside → Check site / straighten line, then RESTART on module A.",
      "Air: PAUSE, Bedside → Clear air from line, then RESTART.",
      "When VTBI runs out the pump drops to KVO. Bedside → Spike & prime the new bag, then CHANNEL SELECT A → VTBI 1000 → START.",
    ],
    debrief: `<p>Treat every alarm as a patient problem first: look at the patient, the site and the line before touching the pump.</p>`,
  },
];
