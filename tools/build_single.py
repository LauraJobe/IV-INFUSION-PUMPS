"""Bundle index.html + css + js into one self-contained HTML page.

Usage: python3 tools/build_single.py OUT.html [--fragment]
--fragment omits <!doctype>/<html>/<head>/<body> (for hosts that add their own).
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1])
fragment = "--fragment" in sys.argv

html = (root / "index.html").read_text()
css = (root / "css/pump.css").read_text()
scripts = re.findall(r'<script src="([^"]+)"></script>', html)
# The offline copy (sw.js) must list every file the page loads.
sw = (root / "sw.js").read_text()
for f in scripts + re.findall(r'href="((?:css|icons)/[^"]+)"', html):
    if f'"{f}"' not in sw:
        sys.exit(f"sw.js APP list is missing {f}")
js = "\n".join((root / s).read_text() for s in scripts)
fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)
body = html.split("<!--BODY-START-->")[1].split("<!--BODY-END-->")[0]
title = re.search(r"<title>(.*?)</title>", html).group(1)

page = (
    f"<title>{title}</title>\n"
    f'<link rel="stylesheet" href="{fonts}">\n'
    f"<style>\n{css}\n</style>\n{body}\n<script>\n{js}\n</script>\n"
)
if not fragment:
    page = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + page.replace(f"{body}", "</head>\n<body>\n" + body, 1) + "</body>\n</html>\n"
    )
out.write_text(page)
print(f"wrote {out} ({len(page) // 1024} KB)")
