/*
 * Modes offered in the dropdown. Practice mode generates random orders
 * (see practice.js); free practice has no order and exposes the bedside
 * panel so every screen and alarm can be explored.
 */

const SCENARIOS = [
  {
    id: "practice", level: "Practice", title: "Practice mode: random orders", practice: true,
    summary: "A new order every round from Med-Surg, ICU, L&D or Pediatrics. Lines are already primed and loaded: just program the pump and press START.",
    setup: () => {},
  },
  {
    id: "free", level: "Practice", title: "Free practice: explore the pump",
    summary: "No order to follow. Start from power-off and try every screen, including tubing, clamps and alarms.",
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
];
