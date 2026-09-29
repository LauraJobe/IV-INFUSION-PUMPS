"""Build a SCORM 1.2 package (zip) of the simulator for an LMS such as Blackboard.

The package opens locked to the check-off: 5 random orders from the practice
order library, one attempt each, reported to the LMS as a percent score
(no pass/fail or mastery score).

Usage: python3 tools/build_scorm.py OUT.zip
"""
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1])
js_files = sorted(str(p.relative_to(root)) for p in (root / "js").glob("*.js"))
files = ["index.html", "css/pump.css", "js/config.js"] + js_files

config = 'window.IVP_CONFIG = { mode: "quiz", lockMode: true, lms: true };\n'
html = (root / "index.html").read_text()
html = html.replace('<script src="js/library.js"></script>', '<script src="js/config.js"></script>\n<script src="js/library.js"></script>', 1)

manifest = f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="IV_PUMP_PRACTICE_LAB" version="1.1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>IV Pump Check-off</title>
      <item identifier="ITEM1" identifierref="RES1">
        <title>IV Pump Check-off: 5 random orders</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="index.html">
{chr(10).join(f'      <file href="{f}"/>' for f in files)}
    </resource>
  </resources>
</manifest>
"""

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("imsmanifest.xml", manifest)
    z.writestr("index.html", html)
    z.writestr("js/config.js", config)
    z.write(root / "css/pump.css", "css/pump.css")
    for f in js_files:
        z.write(root / f, f)
print(f"wrote {out} with {len(files)} files")
