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

Choose **Practice mode: random orders** in the Mode list (it opens by default). Each round is a new made-up patient and order from Med-Surg, ICU, L&D or Pediatrics: fluids, weight-based and titrated drips, IVPB secondaries, peds boluses, blood, and some orders above a hard limit that should be held. Lines are already primed and loaded, so students only program the pump. On START the order is checked item by item (entry, concentration, weight, dose, rate, VTBI) with the math shown. A specialty filter, score and streak are included.

While a channel is selected and not yet started, the pump repeats a single reminder beep until START (SILENCE quiets it).

A **Bedside** panel covers the hands-on steps: spike and prime, load the set, trace the line, roller clamp, hang the secondary higher, open the secondary clamp, check the site, clear air.

## Using it in Blackboard

**Embed (no grades):** in a Blackboard Document/Item, open the HTML source editor and paste
`<iframe src="https://laurajobe.github.io/IV-INFUSION-PUMPS/" width="100%" height="1200" style="border:0" allow="autoplay" title="IV Pump Practice Lab"></iframe>`.
If your institution blocks embedded sites, add it as a Link instead.

**SCORM package (grades):** run `python3 tools/build_scorm.py IV-Pump-Check-off-SCORM.zip` and upload the zip as a SCORM package. It opens as a check-off: 5 random orders from the practice order library (one from each specialty plus one more, no drug repeated), one attempt each. The score sent to the Grade Center is the percent programmed correctly (for example 4 of 5 = 80%). There is no pass/fail or mastery score. The check-off is not offered on the public website.

## Files

- `index.html`: page layout
- `css/pump.css`: styling
- `js/library.js`: practice drug library, profiles (Med-Surg, ICU/PCU, L&D/Postpartum, Pediatrics) and dose math
- `js/pump.js`: pump engine (screens, keys, Guardrails checks, alarms, secondary, titration)
- `js/scenarios.js`: the modes in the dropdown (practice mode and free practice)
- `js/practice.js`: random order generator and grading for practice mode
- `js/app.js`: rendering and controls
- `js/scorm.js`: SCORM 1.2 score reporting for the check-off (does nothing outside an LMS)
- `tools/build_single.py`: bundles everything into one HTML file for sharing
- `tools/build_scorm.py`: builds the SCORM 1.2 zip for Blackboard or another LMS

To edit a limit or add a drug, change `js/library.js`.

## Important

For education only. Not affiliated with or endorsed by BD. Alaris and Guardrails are trademarks of their owners. Drug concentrations and limits are teaching values; always follow your facility's library and policies. Practice patients and orders are made up.
