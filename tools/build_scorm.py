"""Build a SCORM 1.2 package (zip) of the simulator for an LMS such as Blackboard.

Usage: python3 tools/build_scorm.py OUT.zip
"""
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1])
files = ["index.html", "css/pump.css"] + sorted(str(p.relative_to(root)) for p in (root / "js").glob("*.js"))

manifest = f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="IV_PUMP_PRACTICE_LAB" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>IV Pump Practice Lab</title>
      <item identifier="ITEM1" identifierref="RES1">
        <title>IV Pump Practice Lab</title>
        <adlcp:masteryscore>80</adlcp:masteryscore>
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
    for f in files:
        z.write(root / f, f)
print(f"wrote {out} with {len(files)} files")
