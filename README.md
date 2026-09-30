# IV Pump Practice Lab

A browser-based simulator where nursing students practice programming a large-volume IV pump with a Guardrails-style drug library. The interface and button flow follow the BD Alaris™ System with Guardrails™ Suite MX user manual (PC unit with soft keys, pump modules on each side).

The start screen asks students to **select their clinical facility**, which opens the pump that facility uses: Conway → dual-line cassette pump, Children's → single-channel pump or syringe pump (students pick), St. Mary's → single-channel pump, Chambers and Clarksville → compact arrow-key pump, Northwest → modular pump. **See all pumps** opens the pump picker instead, where students **choose a pump** from five drawings (no logos):

- **Modular pump**: center screen with a channel module on each side (Alaris-style workflow).
- **Single-channel pump**: color screen, four round soft keys, ON/OFF · SCAN · OK · RUN/STOP, a keypad that also types letters, and the door on the right (workflow from the Baxter Spectrum IQ operator manual: New Patient → care area → Drug Search by first letters → concentration → CONFIRM → advisory → weight/dose/VTBI → RUN/STOP → Check Flow; secondaries by stopping the pump → program pri/sec → program secndry; dose change from the RUN screen).

- **Dual-line cassette pump**: one cassette with Line A and Line B, a monochrome screen with four soft keys, START / STOP / SELECT ▲▼ (workflow from the Hospira Plum A+ operator manual: Clear Settings? → [A] → Rate / VTBI / Duration with automatic calculation → START; Therapy → Drug List → Dose Calculation → dose units → container units → concentration, weight, dose, VTBI → Confirm Program? Yes; piggyback or concurrent on [B]; titrate with [A] while running). This model has a drug-name list only, **no dose limits**, so hard-limit "hold" orders are not used with it.

- **Compact arrow-key pump**: small black four-line display and **no number keys**. Values are dialed in with ◀ ▶ (pick the digit) and ▲ ▼ (change it), OK confirms (workflow from the B. Braun Infusomat Space Instructions for Use: Press OK to program → Care Unit → drug list with ▶ jumping ABC → DEF → concentration → advisory → weight → doserate editor → VTBI → START on the top line → Start/Stop; soft limit "Override?" Yes ▲ / No ▼; the editor stops at a hard limit and shows a message; SECondary from the stopped home screen with a bag-height reminder; titrate with ◀ then OK).

- **Syringe pump**: syringe on top, green screen, four soft keys and a number keypad (Medfusion 3500 workflow as used on the pediatric units): Power → self test → **Select mode** (mL/hr, Volume/Time, Dose/Time, Dose/kg, Recall last settings; dose modes then pick Category → Drug program) → **Select syringe type** (B-D, Monoject, Terumo) → load the syringe (size recognized; 1 and 3 mL must be confirmed) → enter the settings → the prompt alternates *Press START to begin* / *Press BOLUS to prime* (prime = press and hold BOLUS, EXIT when done) → START. Intermittent and volume/time infusions beep when complete and offer a line flush; the pump also beeps when the syringe is empty. CHG DOSE titrates. Its own pediatric syringe library (`SYR_DRUGS` in `js/library.js`) and practice orders (drips, intermittent doses, titrations, holds; each names the syringe pharmacy sent). Grading and the syringe check-off will be refined once the unit's exact programming steps are confirmed.

The compact arrow-key pump asks **IV Fluids or Medications** after the care unit, then the medication type (Antibiotics, Heart & Blood Pressure, Sedation & Pain, Electrolytes, Anticoagulants & Insulin, OB), then the drug.

Practice mode, free practice, the check-off, grading and the drug library are shared by all five pumps. **Change facility** switches at any time; the choice is remembered on that device. The facility list is `FACILITIES` in `js/app.js`.

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

**SCORM packages (grades):** there is one package per pump, so a graded check-off uses only that pump (no picker, no Change pump button). Run `python3 tools/build_scorm.py IV-Pump-Check-off-Modular-SCORM.zip --device mod`, `python3 tools/build_scorm.py IV-Pump-Check-off-Single-Channel-SCORM.zip --device sq`, `python3 tools/build_scorm.py IV-Pump-Check-off-Dual-Line-SCORM.zip --device plum`, `python3 tools/build_scorm.py IV-Pump-Check-off-Compact-SCORM.zip --device space` and/or `python3 tools/build_scorm.py IV-Pump-Check-off-Syringe-SCORM.zip --device syr`, then upload each zip as its own SCORM package. It opens as a check-off: 5 random orders from the practice order library (one from each specialty plus one more, no drug repeated), one attempt each. The score sent to the Grade Center is the percent programmed correctly (for example 4 of 5 = 80%). There is no pass/fail or mastery score. The check-off is not offered on the public website.

## Files

- `index.html`: page layout
- `css/pump.css`: styling
- `js/library.js`: practice drug library, profiles (Med-Surg, ICU/PCU, L&D/Postpartum, Pediatrics) and dose math
- `js/pump.js`: modular pump engine (screens, keys, Guardrails checks, alarms, secondary, titration)
- `js/spectrum.js`: single-channel pump engine (same log events, so practice grading is shared)
- `js/plum.js`: dual-line cassette pump engine
- `js/space.js`: compact arrow-key pump engine
- `js/syringe.js`: syringe pump engine
- `js/scenarios.js`: the modes in the dropdown (practice mode and free practice)
- `js/practice.js`: random order generator and grading for practice mode
- `js/app.js`: rendering and controls
- `js/scorm.js`: SCORM 1.2 score reporting for the check-off (does nothing outside an LMS)
- `tools/build_single.py`: bundles everything into one HTML file for sharing
- `tools/build_scorm.py`: builds the SCORM 1.2 zip for Blackboard or another LMS

To edit a limit or add a drug, change `js/library.js`.

## Important

For education only. Not affiliated with or endorsed by BD. Alaris and Guardrails are trademarks of their owners. Drug concentrations and limits are teaching values; always follow your facility's library and policies. Practice patients and orders are made up.
