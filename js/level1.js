/*
 * Level 1 check-off bank (modular pump, adult Med-Surg): 40 orders using
 * only basic IV fluids as primaries and intermittent IVPB secondaries.
 * The Level 1 SCORM package offers 10 of these at random.
 *
 * p = primary fluid: f = fluid id, bag = bag volume on hand; either
 *     rate (mL/h, VTBI = bag) or vol + hrs ("infuse vol mL over hrs").
 * s = secondary: d = IVPB drug id, c = concentration index, min = minutes;
 *     pf / pr = primary fluid running on Channel A and its rate.
 * pt = [name, age, weight kg], dx = reason for the order.
 * Teaching values only: not a clinical reference.
 */
const LEVEL1_BANK = [
  // ---------------- primary infusions ----------------
  { t: "p", f: "ns", bag: 1000, rate: 110, pt: ["Harold Whitfield", 71, 78], dx: "Dehydration from gastroenteritis" },
  { t: "p", f: "lr", bag: 1000, rate: 100, pt: ["Keisha Montgomery", 38, 70], dx: "Post-op day 0, laparoscopic cholecystectomy" },
  { t: "p", f: "d5halfns", bag: 1000, rate: 75, pt: ["Walter Pruitt", 64, 92], dx: "NPO after midnight for surgery" },
  { t: "p", f: "d5ns", bag: 1000, rate: 80, pt: ["Marisol Vega", 57, 66], dx: "Small bowel obstruction, NPO with NG tube" },
  { t: "p", f: "halfns", bag: 1000, rate: 100, pt: ["Dorothy Kessler", 83, 54], dx: "Mild hypernatremia, poor oral intake" },
  { t: "p", f: "d5w", bag: 1000, rate: 60, pt: ["Eugene Farrow", 79, 68], dx: "Hypernatremia: free water replacement" },
  { t: "p", f: "d5halfnsk", bag: 1000, rate: 100, pt: ["Luis Alvarado", 46, 84], dx: "Post-op, NPO, potassium 3.4" },
  { t: "p", f: "ns", bag: 500, vol: 500, hrs: 5, pt: ["Ruth Abernathy", 76, 61], dx: "Acute kidney injury, prerenal" },
  { t: "p", f: "lr", bag: 1000, vol: 1000, hrs: 10, pt: ["Terrence Boyd", 52, 97], dx: "Post-op day 1, colectomy" },
  { t: "p", f: "ns", bag: 1000, rate: 150, pt: ["Alyssa Harmon", 29, 63], dx: "Pyelonephritis with vomiting" },
  { t: "p", f: "lr", bag: 1000, rate: 200, pt: ["Dennis Okafor", 44, 88], dx: "Acute pancreatitis" },
  { t: "p", f: "ns", bag: 1000, rate: 30, pt: ["Beatrice Lindqvist", 88, 50], dx: "Keep vein open while taking fluids by mouth" },
  { t: "p", f: "d5ns", bag: 1000, rate: 100, pt: ["Victor Nakamura", 61, 75], dx: "NPO for endoscopy" },
  { t: "p", f: "halfns", bag: 1000, vol: 1000, hrs: 10, pt: ["Gloria Castillo", 67, 72], dx: "Maintenance fluids, NPO" },
  { t: "p", f: "d5w", bag: 500, rate: 40, pt: ["Norris Pennington", 74, 81], dx: "Hypernatremia, fluid-restricted" },
  { t: "p", f: "ns", bag: 1000, rate: 75, pt: ["Jada Reynolds", 35, 77], dx: "Cellulitis of the left leg" },
  { t: "p", f: "lr", bag: 1000, rate: 110, pt: ["Frank Dalton", 69, 101], dx: "Post-op day 0, total knee replacement" },
  { t: "p", f: "d5halfnsk", bag: 1000, rate: 80, pt: ["Opal Jennings", 81, 58], dx: "Poor oral intake, potassium 3.5" },
  { t: "p", f: "halfns", bag: 1000, vol: 1000, hrs: 5, pt: ["Samuel Ortiz", 23, 74], dx: "Dehydration after heat exposure" },
  { t: "p", f: "d5ns", bag: 1000, rate: 60, pt: ["Mabel Holloway", 86, 55], dx: "NPO, history of heart failure (low rate)" },
  // ---------------- secondary (IVPB) infusions ----------------
  { t: "s", d: "cefazolin", c: 0, min: 60, pf: "ns", pr: 75, pt: ["Reggie Fontaine", 58, 90], dx: "Cellulitis of the right arm" },
  { t: "s", d: "cefazolin", c: 1, min: 30, pf: "lr", pr: 100, pt: ["Tanya Whitaker", 42, 68], dx: "Post-op wound prophylaxis" },
  { t: "s", d: "ceftriaxone", c: 0, min: 60, pf: "d5halfns", pr: 75, pt: ["Curtis Bell", 77, 70], dx: "Community-acquired pneumonia" },
  { t: "s", d: "ceftriaxone", c: 0, min: 60, pf: "ns", pr: 100, pt: ["June Takahashi", 66, 57], dx: "Urinary tract infection" },
  { t: "s", d: "vancomycin", c: 0, min: 120, pf: "ns", pr: 50, pt: ["Hector Salinas", 54, 86], dx: "MRSA cellulitis" },
  { t: "s", d: "vancomycin", c: 1, min: 120, pf: "ns", pr: 75, pt: ["Esther Ramsey", 63, 99], dx: "Osteomyelitis of the foot" },
  { t: "s", d: "vancomycin", c: 1, min: 150, pf: "lr", pr: 75, pt: ["Owen Garrison", 49, 112], dx: "Infected surgical wound" },
  { t: "s", d: "piptazo", c: 0, min: 30, pf: "lr", pr: 100, pt: ["Priya Desai", 31, 60], dx: "Perforated appendicitis" },
  { t: "s", d: "piptazo", c: 0, min: 240, pf: "ns", pr: 75, pt: ["Leon Carver", 72, 83], dx: "Intra-abdominal infection (extended infusion)" },
  { t: "s", d: "ciprofloxacin", c: 0, min: 60, pf: "d5ns", pr: 80, pt: ["Wendell Stroud", 68, 79], dx: "Pyelonephritis" },
  { t: "s", d: "metronidazole", c: 0, min: 60, pf: "lr", pr: 125, pt: ["Rosa Quintero", 59, 65], dx: "Diverticulitis" },
  { t: "s", d: "metronidazole", c: 0, min: 60, pf: "d5halfnsk", pr: 100, pt: ["Marcus Ellison", 47, 91], dx: "C. difficile colitis, NPO" },
  { t: "s", d: "cefazolin", c: 0, min: 60, pf: "halfns", pr: 75, pt: ["Imani Brooks", 26, 71], dx: "Infected IV site, cellulitis" },
  { t: "s", d: "ceftriaxone", c: 0, min: 60, pf: "d5w", pr: 50, pt: ["Yolanda Price", 80, 53], dx: "Pneumonia, hypernatremia" },
  { t: "s", d: "ciprofloxacin", c: 0, min: 60, pf: "ns", pr: 125, pt: ["Avery Coleman", 36, 82], dx: "Complicated urinary tract infection" },
  { t: "s", d: "vancomycin", c: 0, min: 120, pf: "d5halfns", pr: 80, pt: ["Lorena Beaumont", 70, 64], dx: "Infected pressure injury" },
  { t: "s", d: "piptazo", c: 0, min: 30, pf: "d5ns", pr: 75, pt: ["Keith Underwood", 62, 88], dx: "Aspiration pneumonia, NPO" },
  { t: "s", d: "cefazolin", c: 1, min: 30, pf: "d5halfns", pr: 100, pt: ["Nadia Kowalski", 51, 69], dx: "Pre-op antibiotic before hip surgery" },
  { t: "s", d: "metronidazole", c: 0, min: 60, pf: "halfns", pr: 100, pt: ["Tomás Herrera", 45, 76], dx: "Liver abscess" },
  { t: "s", d: "vancomycin", c: 0, min: 150, pf: "ns", pr: 100, pt: ["Grace Yates", 84, 52], dx: "MRSA pneumonia, older adult (slower infusion)" },
];
