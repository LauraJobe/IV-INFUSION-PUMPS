# IV Pump Practice Lab

A browser-based simulator where nursing students practice programming a large-volume IV pump with a Guardrails-style drug library. The interface and button flow follow the BD Alaris™ System with Guardrails™ Suite MX user manual (PC unit with soft keys, pump modules on each side).

**Open `index.html` in any browser.** No install, no internet needed except for fonts. It also works on GitHub Pages.

## What students do

1. Press **SYSTEM ON** and watch the self test.
2. Answer **New Patient? → Yes**, select the unit **profile**, and enter the **patient ID** from the armband.
3. Press **CHANNEL SELECT** on a module (Channel A on the left, Channel B on the right).
4. Follow the manual's flow: Infusion Menu → Guardrails Drugs / IV Fluids → letter groups → concentration → *"…was selected. Is this correct?"* → clinical advisory → Drug Setup (patient weight) → RATE / VTBI / DOSE → **START**.
5. Handle soft limits (*Proceed? Yes/No*), hard limits (*Reprogram*), secondary infusions, titrations, and alarms.

## Practice mode

Choose **Random orders: program the pump** at the top of the scenario list (it opens by default). Each round is a new made-up patient and order from Med-Surg, ICU, L&D or Pediatrics: fluids, weight-based and titrated drips, IVPB secondaries, peds boluses, blood, and some orders above a hard limit that should be held. Lines are already primed and loaded, so students only program the pump. On START the order is checked item by item (entry, concentration, weight, dose, rate, VTBI) with the math shown. A specialty filter, score and streak are included.

While a channel is selected and not yet started, the pump repeats a single reminder beep until START (SILENCE quiets it).

A **Bedside** panel covers the hands-on steps: spike and prime, load the set, trace the line, roller clamp, hang the secondary higher, open the secondary clamp, check the site, clear air.

## Scenarios (from the ATU Simulation Hospital charts in Notion)

| Level | Patient | Skills |
|---|---|---|
| 1 | Charles Jones | Start-up from power on; NS at KVO |
| 1 | Charles Jones | KCl rider meets a **hard limit**; clarify the order |
| 1 | Sara Lin | Ceftriaxone **secondary**; reduce maintenance rate |
| 2 | Jane Fowler | LR primary + pre-op cefazolin secondary |
| 2 | Amelia Sung | Oxytocin induction (mU/min), titration, tachysystole |
| 2 | Fatima Sanogo | Postpartum oxytocin, correct library entry, two-step rate |
| 2 | Molly Thomas | Pediatric 20 mL/kg bolus; VTBI ≠ bag volume |
| 2 | Stephanie Smith | PRBC on a second channel; compatible priming fluid |
| 3 | Vernon Watkins | Weight-based heparin protocol + titration |
| 3 | Ruth Livingston | NS bolus at pump max, norepinephrine start and titration |
| 3 | Carl Shapiro | IV nitroglycerin start and titration |
| 3 | Vincent Brody | Occlusion, air-in-line and infusion-complete alarms |

Each scenario shows the patient armband (with patient ID), the provider order, a live checklist, hints, decision questions, a debrief, and the pump's event history. Details marked "sim extension" were added for pump practice (for example bag sizes, patient ID numbers, vital sign changes).

## Files

- `index.html`: page layout
- `css/pump.css`: styling
- `js/library.js`: practice drug library, profiles (Med-Surg, ICU/PCU, L&D/Postpartum, Pediatrics) and dose math
- `js/pump.js`: pump engine (screens, keys, Guardrails checks, alarms, secondary, titration)
- `js/scenarios.js`: patient scenarios and checklists
- `js/practice.js`: random order generator and grading for practice mode
- `js/app.js`: rendering and controls
- `tools/build_single.py`: bundles everything into one HTML file for sharing

To edit a limit or add a drug, change `js/library.js`. To add a scenario, copy one in `js/scenarios.js`.

## Important

For education only. Not affiliated with or endorsed by BD. Alaris and Guardrails are trademarks of their owners. Drug concentrations and limits are teaching values; always follow your facility's library and policies. The heparin scenario uses common protocol values (80 units/kg bolus, 18 units/kg/hr): check them against the protocol PDF in the Watkins chart.
