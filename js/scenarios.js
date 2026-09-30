/*
 * Modes offered in the dropdown. Practice mode generates random orders
 * (see practice.js); free practice has no order and exposes the bedside
 * panel so every screen and alarm can be explored.
 */

const SCENARIOS = [
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
