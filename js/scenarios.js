/*
 * Modes offered in the dropdown. Practice mode generates random orders
 * (see practice.js); free practice has no order and exposes the bedside
 * panel so every screen and alarm can be explored.
 */

const SCENARIOS = [
  {
    // Simulation orientation (modular pump page only): a short guided tour, one task at a time.
    id: "orient", level: "Orientation", title: "Pump orientation: guided tasks", pageOnly: true, sequential: true, noBedside: true,
    summary: "Seven short tasks that cover what you will do on the pump in simulation. Each task shows its steps and checks itself off when you do it on the pump.",
    patient: { name: "Jordan Avery", mrn: "246810", age: "58 y", weight: "80 kg", allergies: "No known allergies", dx: "Cellulitis, right leg", unit: "Adult Med-Surg", source: "Orientation practice patient (fictional)" },
    setup: (P) => {
      P.reset();
      const ready = { primed: true, loaded: true, traced: true, clampOpen: true };
      Object.assign(P.state.channels.A.bedside, ready, { primaryBag: 1000, primaryBagName: "0.9% Sodium Chloride 1000 mL",
        secondaryHung: true, secondaryClampOpen: true, secondaryBag: 55, secondaryBagName: "Cefazolin 1 g / 50 mL" });
      Object.assign(P.state.channels.B.bedside, ready, { primaryBag: 500, primaryBagName: "Heparin 25,000 units / 500 mL" });
      P.emit();
    },
    order: () => `<ul class="orient-orders">
      <li><b>0.9% Sodium Chloride 1000 mL</b> IV at <b>100 mL/hr</b> (Channel A)</li>
      <li><b>Cefazolin 1 g in 50 mL</b> IVPB over <b>30 minutes</b> (secondary on Channel A)</li>
      <li><b>Heparin 25,000 units in 500 mL</b> at <b>12 units/kg/hr</b> (Channel B). Weight 80 kg.</li>
      <li>Later: increase heparin to <b>14 units/kg/hr</b> per protocol.</li></ul>
      <p class="policy">Tubing is primed and loaded, and the secondary bag is hung above the primary with its clamp open.</p>`,
    goals: [
      { text: "Turn the pump on", how: ["Press <b>SYSTEM ON</b> (bottom right of the keypad).", "Wait for the self test to finish."],
        check: (S) => S.log.some((e) => e.type === "powerOn") },
      { text: "Start a new patient on Adult Med-Surg", how: ["<b>New Patient?</b> → press <b>Yes</b>.", "Choose <b>Adult Med-Surg</b> → <b>Yes</b> to confirm the unit.", "Type the patient ID <b>246810</b> → <b>CONFIRM</b>."],
        check: (S) => S.log.some((e) => e.type === "profile" && e.profile === "medsurg") && S.log.some((e) => e.type === "patientId") },
      { text: "Start the primary IV fluid on Channel A", how: ["Press <b>CHANNEL SELECT</b> on module <b>A</b>.", "<b>Guardrails IV Fluids</b> → <b>P-T</b> → <b>Sodium Chloride 0.9%</b> → <b>1,000 mL</b> → <b>Yes</b>.", "<b>RATE</b> → type <b>100</b> → <b>VTBI</b> → type <b>1000</b>.", "Check the screen against the order → <b>START</b>."],
        check: (S) => S.log.some((e) => e.type === "start" && e.ch === "A" && e.drugId === "ns" && Math.abs(e.rate - 100) < 0.01 && Math.abs(e.vtbi - 1000) < 0.01) },
      { text: "Run the antibiotic as a secondary on Channel A", how: ["Press <b>CHANNEL SELECT</b> on module <b>A</b> → <b>SECONDARY</b>.", "<b>A-E</b> → <b>Cefazolin</b> → <b>1 g/50 mL</b> → <b>Yes</b>.", "VTBI fills in as 50. Type the <b>DURATION</b>: <b>30</b> (minutes). The rate becomes 100 mL/hr.", "<b>START</b>. The primary resumes by itself when the secondary is done."],
        check: (S) => S.log.some((e) => e.type === "startSecondary" && e.ch === "A" && e.drugId === "cefazolin" && Math.abs(e.rate - 100) < 0.01 && Math.abs(e.vtbi - 50) < 0.01) },
      { text: "Start the heparin drip on Channel B", how: ["Press <b>CHANNEL SELECT</b> on module <b>B</b> → <b>Guardrails Drugs</b>.", "<b>F-J</b> → <b>Heparin</b> → <b>25,000 units/500 mL</b> → <b>Yes</b> → <b>CONFIRM</b> the high-alert notice.", "<b>PATIENT WEIGHT</b> → <b>80</b> → <b>CONFIRM</b> → <b>NEXT</b>.", "<b>DOSE</b> → <b>12</b> → <b>VTBI</b> → <b>500</b>. The pump works out the rate (19.2 mL/hr).", "High-alert drug: have a second nurse check it, then <b>START</b>."],
        check: (S) => S.log.some((e) => e.type === "start" && e.ch === "B" && e.drugId === "heparin" && Math.abs(e.dose - 12) < 0.01 && Math.abs(e.weight - 80) < 0.01 && e.concVol === 500) },
      { text: "Pause Channel A, then restart it", how: ["Press <b>PAUSE</b> on module <b>A</b> (for example, to check the IV site).", "Press <b>RESTART</b> on module <b>A</b> to continue."],
        check: (S) => { const i = S.log.findIndex((e) => e.type === "pause" && e.ch === "A"); return i >= 0 && S.log.slice(i).some((e) => e.type === "resume" && e.ch === "A"); } },
      { text: "Increase the heparin to 14 units/kg/hr", how: ["Press <b>CHANNEL SELECT</b> on module <b>B</b>.", "Press <b>DOSE</b> → type <b>14</b>. Change the dose, not the rate: the pump works out the new rate (22.4 mL/hr).", "<b>START</b> to give the new dose."],
        check: (S) => S.log.some((e) => e.type === "titrate" && e.ch === "B" && e.drugId === "heparin" && Math.abs(e.toDose - 14) < 0.01) },
    ],
    debrief: `<p>You programmed a primary fluid, a secondary piggyback, a weight-based high-alert drip, a pause and restart, and a dose change. In simulation, always:</p>
      <ul><li>Check the patient, the order and the bag before you program.</li><li>Pick the drug from the library (Guardrails) so the dose limits protect your patient.</li><li>Read the screen against the order before you press START.</li><li>Change a drip by its <b>dose</b>, not its rate.</li></ul>
      <p>Next: pick <b>Practice mode</b> for random orders, or <b>Free practice</b> to explore.</p>`,
  },
  {
    id: "practice", level: "Practice", title: "Practice mode: random orders", practice: true,
    summary: "A new order every round from Med-Surg, ICU, L&D or Pediatrics. Lines are already primed and loaded: just program the pump and start it.",
    setup: () => {},
  },
  {
    // Only offered in the SCORM (LMS) build, not on the public website.
    id: "quiz", level: "Practice", title: "Check-off: 5 random orders", practice: true, quiz: true, count: 5, lmsOnly: true,
    summary: "Five random orders from different specialties, one attempt each, then a score (percent of orders programmed correctly).",
    setup: () => {},
  },
  {
    // Level 1 SCORM (modular pump): 10 of the 40 Med-Surg orders in level1.js.
    id: "level1", level: "Practice", title: "Level 1 check-off: primary & secondary IV", practice: true, quiz: true, count: 10, bank: "level1", lmsOnly: true,
    summary: "Ten random Med-Surg orders: basic IV fluids as primary infusions and IVPB secondary infusions. One attempt each, then a score (percent programmed correctly).",
    setup: () => {},
  },
  {
    id: "free", level: "Practice", title: "Free practice: explore the pump",
    summary: "No order to follow. Start from power-off and try every screen. Tubing is already primed and loaded.",
    patient: null,
    noBedside: true,
    setup: (P) => {
      P.reset();
      // Lines ready on both channels, with a secondary bag hung and open.
      CHANNEL_IDS.forEach((id) => Object.assign(P.state.channels[id].bedside, {
        primed: true, loaded: true, traced: true, clampOpen: true, primaryBag: 5000, primaryBagName: "Primary bag",
        secondaryHung: true, secondaryClampOpen: true, secondaryBag: 5000, secondaryBagName: "Secondary bag",
      }));
      P.emit();
    },
    order: () => `<p>No order. Try each feature: start-up, a drug from the library, a weight-based drip, a titration, a secondary, a soft-limit override and a hard limit.</p>`,
    bags: [
      { name: "0.9% Sodium Chloride 1000 mL", vol: 1000 },
      { name: "Lactated Ringer's 1000 mL", vol: 1000 },
      { name: "Heparin 25,000 units / 250 mL", vol: 250 },
      { name: "Norepinephrine 4 mg / 250 mL", vol: 250 },
      { name: "Cefazolin 2 g / 100 mL (secondary)", vol: 100, secondary: true },
      { name: "Vancomycin 1 g / 250 mL (secondary)", vol: 250, secondary: true },
    ],
    goals: [],
    hints: ["Press the power key to begin (SYSTEM ON on the modular pump, ON/OFF on the single-channel pump).",
      "Modular pump: after start-up, press CHANNEL SELECT on module A or B. Single-channel pump: answer New Patient, pick the care area with ▲▼ and OK, then type the first letters of the drug."],
  },
];
