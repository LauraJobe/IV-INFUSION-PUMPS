/*
 * Modes offered in the dropdown. Practice mode generates random orders
 * (see practice.js); free practice has no order and exposes the bedside
 * panel so every screen and alarm can be explored.
 */

const SCENARIOS = [
  {
    // Simulation orientation (modular pump page only): a short guided tour, one task at a time.
    // Each goal: check (done), wrong (hint when what is running does not match the order),
    // show (the next key for "Show me", from the pump screen) and targets (fallback order).
    id: "orient", level: "Orientation", title: "Pump orientation: guided tasks", pageOnly: true, sequential: true, noBedside: true,
    summary: "Five short tasks: turn the pump on, pick the unit, then program a maintenance fluid, a piggyback and a weight-based drip. Each task checks itself off when you do it on the pump. Stuck? Press Show me.",
    patient: { name: "Jordan Avery", mrn: "246810", age: "58 y", weight: "80 kg", allergies: "No known allergies", dx: "Cellulitis, right leg", unit: "Adult Med-Surg", source: "Orientation practice patient (fictional)" },
    setup: (P) => {
      P.reset();
      const ready = { primed: true, loaded: true, traced: true, clampOpen: true };
      Object.assign(P.state.channels.A.bedside, ready, { primaryBag: 1000, primaryBagName: "Dextrose 5%-NaCl 0.45% 1000 mL",
        secondaryHung: true, secondaryClampOpen: true, secondaryBag: 55, secondaryBagName: "Cefazolin 1 g / 50 mL" });
      Object.assign(P.state.channels.B.bedside, ready, { primaryBag: 500, primaryBagName: "Heparin 25,000 units / 500 mL" });
      P.emit();
    },
    order: () => `<ul class="orient-orders">
      <li><b>Dextrose 5% / 0.45% NaCl 1000 mL</b> IV at <b>100 mL/hr</b> maintenance (Channel A)</li>
      <li><b>Cefazolin 1 g in 50 mL</b> IVPB over <b>30 minutes</b> (piggyback on Channel A)</li>
      <li><b>Heparin 25,000 units in 500 mL</b> at <b>12 units/kg/hr</b> (Channel B). Weight 80 kg.</li></ul>
      <p class="policy">Tubing is primed and loaded, and the piggyback bag is hung above the primary with its clamp open.</p>`,
    goals: [
      { text: "Turn the pump on", how: ["Press <b>SYSTEM ON</b> (bottom right of the keypad).", "Wait for the self test to finish."],
        check: (S) => S.log.some((e) => e.type === "powerOn"), targets: ["#powerKey"] },
      { text: "Start a new patient and select the unit", how: ["<b>New Patient?</b> → press <b>Yes</b>.", "Choose <b>Adult Med-Surg</b> → <b>Yes</b> to confirm the unit.", "Type the patient ID <b>246810</b> → <b>CONFIRM</b>."],
        check: (S) => S.log.some((e) => e.type === "profile" && e.profile === "medsurg") && S.log.some((e) => e.type === "patientId"),
        wrong: (S) => (S.profile && S.profile !== "medsurg" ? `The unit selected is ${PROFILES[S.profile].name}. This patient is on <b>Adult Med-Surg</b>: turn the pump off and on, answer New Patient? <b>Yes</b>, and pick Adult Med-Surg.` : null),
        show: (S) => (S.screen.id === "patientId" ? { t: "lcd:CONFIRM", tip: S.buffer ? "Press CONFIRM" : "Type 246810, then CONFIRM" } : null),
        targets: ["lcd:Yes", "lcd:Adult Med-Surg", "lcd:Yes", "lcd:CONFIRM"] },
      { text: "Start the maintenance IV fluid on Channel A", how: ["Press <b>CHANNEL SELECT</b> on module <b>A</b>.", "<b>Guardrails IV Fluids</b> → <b>A-E</b> → <b>Dextrose 5%-NaCl 0.45%</b> → <b>Yes</b>.", "<b>RATE</b> → type <b>100</b> → <b>VTBI</b> → type <b>1000</b>.", "Check the screen against the order → <b>START</b>."],
        check: (S) => { const p = S.channels.A.primary; return !!p && p.drugId === "d5halfns" && Math.abs(p.rate - 100) < 0.01 && Math.abs(p.vtbi - 1000) < 0.01; },
        wrong: (S) => {
          const p = S.channels.A.primary;
          if (!p) return null;
          if (p.drugId !== "d5halfns") return `Channel A is running <b>${DRUGS[p.drugId] ? DRUGS[p.drugId].name : "a basic infusion"}</b>. Recheck the order: the maintenance fluid is Dextrose 5%-NaCl 0.45%. Press <b>CHANNEL OFF</b> on module A, then program it again.`;
          return `Channel A is set to ${fmtNum(p.rate, 1)} mL/hr with a VTBI of ${fmtNum(p.vtbi)} mL. Recheck the order: <b>100 mL/hr, VTBI 1000</b>. Press <b>CHANNEL SELECT</b> on module A, fix the value, then <b>START</b>.`;
        },
        show: (S) => {
          const sc = S.screen, d = sc.draft;
          if (sc.id !== "program" || !d || d.drugId !== "d5halfns") return null;
          const typing = (f) => d.field === f && S.buffer !== "";
          if (d.rate == null && !typing("rate")) return { t: "lcd:RATE", tip: "Press RATE, type 100" };
          if ((d.vtbi == null || Math.abs(d.vtbi - 1000) > 0.01) && !typing("vtbi")) return { t: "lcd:VTBI", tip: "Press VTBI, type 1000" };
          return { t: "lcd:START", tip: "Check the screen, then START" };
        },
        targets: ["mk:A:SELECT", "lcd:Guardrails IV Fluids", "lcd:A-E", "lcd:Dextrose 5%-NaCl 0.45%", "lcd:Yes"] },
      { text: "Run the antibiotic as a piggyback (secondary) on Channel A", how: ["Press <b>CHANNEL SELECT</b> on module <b>A</b> → <b>SECONDARY</b>.", "<b>A-E</b> → <b>Cefazolin</b> → <b>1 g/50 mL</b> → <b>Yes</b>.", "VTBI fills in as 50. Type the <b>DURATION</b>: <b>30</b> (minutes). The rate becomes 100 mL/hr.", "<b>START</b>. The primary restarts by itself when the piggyback is done."],
        check: (S) => { const s2 = S.channels.A.secondary; return (!!s2 && s2.drugId === "cefazolin" && Math.abs(s2.rate - 100) < 0.01 && Math.abs(s2.vtbi - 50) < 0.01) || S.log.some((e) => e.type === "startSecondary" && e.ch === "A" && e.drugId === "cefazolin" && Math.abs(e.rate - 100) < 0.01 && Math.abs(e.vtbi - 50) < 0.01); },
        wrong: (S) => {
          const asPrimary = ["A", "B"].find((id) => S.channels[id].primary && S.channels[id].primary.drugId === "cefazolin");
          if (asPrimary) return `Cefazolin was started as a <b>primary</b> on Channel ${asPrimary}. A piggyback goes on the <b>SECONDARY</b> key. Press <b>CHANNEL OFF</b> on module ${asPrimary}, then use CHANNEL SELECT on A → SECONDARY.`;
          const s2 = S.channels.A.secondary;
          if (s2 && s2.drugId !== "cefazolin") return `The piggyback running is <b>${DRUGS[s2.drugId] ? DRUGS[s2.drugId].name : "a basic infusion"}</b>. Recheck the order: cefazolin 1 g/50 mL.`;
          if (s2) return `The piggyback is set to ${fmtNum(s2.rate, 1)} mL/hr, VTBI ${fmtNum(s2.vtbi)} mL. Recheck the order: 50 mL over 30 minutes is <b>100 mL/hr</b>.`;
          return null;
        },
        show: (S) => {
          const sc = S.screen, d = sc.draft;
          if (sc.id !== "program" || !d || !d.secondary || d.drugId !== "cefazolin") return null;
          if (d.duration == null && !(d.field === "duration" && S.buffer !== "")) return { t: "lcd:DURATION", tip: "Type 30 (minutes)" };
          return { t: "lcd:START", tip: "Check the rate (100 mL/hr), then START" };
        },
        targets: ["mk:A:SELECT", "lcd:SECONDARY", "lcd:A-E", "lcd:Cefazolin", "lcd:1 g/50 mL", "lcd:Yes"] },
      { text: "Start the weight-based heparin drip on Channel B", how: ["Press <b>CHANNEL SELECT</b> on module <b>B</b> → <b>Guardrails Drugs</b>.", "<b>F-J</b> → <b>Heparin</b> → <b>25,000 units/500 mL</b> → <b>Yes</b> → <b>CONFIRM</b> the high-alert notice.", "<b>PATIENT WEIGHT</b> → <b>80</b> → <b>CONFIRM</b> → <b>NEXT</b>.", "<b>DOSE</b> → <b>12</b> → <b>VTBI</b> → <b>500</b>. The pump works out the rate (19.2 mL/hr).", "High-alert drug: have a second nurse check it, then <b>START</b>."],
        check: (S) => { const p = S.channels.B.primary; return !!p && p.drugId === "heparin" && Math.abs(p.dose - 12) < 0.01 && Math.abs((p.weight || 0) - 80) < 0.01 && p.conc && p.conc.vol === 500; },
        wrong: (S) => {
          const p = ["A", "B"].map((id) => S.channels[id].primary).find((x) => x && x.drugId === "heparin");
          if (!p) return null;
          if (S.channels.A.primary === p) return "Heparin was started on Channel A. It goes on <b>Channel B</b>. Press <b>CHANNEL OFF</b> on module A, then restart the maintenance fluid there.";
          if (p.conc && p.conc.vol !== 500) return "Wrong bag: the order is heparin 25,000 units in <b>500 mL</b>. Press <b>CHANNEL OFF</b> on module B, then program it again.";
          if (Math.abs((p.weight || 0) - 80) > 0.01) return `The weight entered is ${fmtNum(p.weight || 0)} kg. The patient weighs <b>80 kg</b>. Press <b>CHANNEL OFF</b> on module B, then program it again.`;
          return `The dose is ${fmtNum(p.dose, 3)} units/kg/hr. The order is <b>12 units/kg/hr</b>. Press <b>CHANNEL SELECT</b> on module B → <b>DOSE</b>, fix it, then <b>START</b>.`;
        },
        show: (S) => {
          const sc = S.screen, d = sc.draft;
          if (sc.id === "weight") return { t: "lcd:CONFIRM", tip: S.buffer ? "Press CONFIRM" : "Type 80, then CONFIRM" };
          if (sc.id === "setup" && sc.drug && /heparin/i.test(sc.drug.name)) return S.weight ? { t: "lcd:NEXT", tip: "Press NEXT" } : { t: "lcd:PATIENT WEIGHT", tip: "Press PATIENT WEIGHT, type 80" };
          if (sc.id !== "program" || !d || d.drugId !== "heparin") return null;
          const typing = (f) => d.field === f && S.buffer !== "";
          if (d.dose == null && !typing("dose")) return { t: "lcd:DOSE", tip: "Press DOSE, type 12" };
          if ((d.vtbi == null || Math.abs(d.vtbi - 500) > 0.01) && !typing("vtbi")) return { t: "lcd:VTBI", tip: "Press VTBI, type 500" };
          return { t: "lcd:START", tip: "Second nurse check, then START" };
        },
        targets: ["mk:B:SELECT", "lcd:Guardrails Drugs", "lcd:F-J", "lcd:Heparin", "lcd:25,000 units/500 mL", "lcd:Yes", "lcd:CONFIRM"] },
    ],
    debrief: `<p>You turned the pump on, selected the unit, and programmed a maintenance fluid, a piggyback and a weight-based high-alert drip. In simulation, always:</p>
      <ul><li>Check the patient, the order and the bag before you program.</li><li>Pick the drug from the library (Guardrails) so the dose limits protect your patient.</li><li>Use the <b>SECONDARY</b> key for a piggyback.</li><li>Read the screen against the order before you press START.</li></ul>`,
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
