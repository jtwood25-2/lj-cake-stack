"""Wrap game.html (page content only) into index.html, a full document for static hosting.

game.html stays skeleton-free because the claude.ai preview adds its own <html>/<head>;
any other host needs the real document this produces.

    python build.py
"""
import argparse
import json
import pathlib
import sys

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#121a2c">
<meta name="description" content="Stack Lauren and Jackson's wedding cake as high as you can.">
<meta property="og:title" content="Cake Stack · Lauren &amp; Jackson">
<meta property="og:description" content="Stack the wedding cake as high as you can. Beat the family.">
<meta property="og:type" content="website">
<style>[hidden]{display:none!important}:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
"""
TAIL = "\n</body>\n</html>\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", default="game.html")
    ap.add_argument("--out", default="index.html")
    a = ap.parse_args()
    here = pathlib.Path(__file__).parent
    try:
        body = (here / a.src).read_text(encoding="utf-8")
    except OSError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    if "<html" in body.lower():
        print(json.dumps({"error": f"{a.src} already contains <html>; it must be page content only"}))
        sys.exit(1)
    (here / a.out).write_text(HEAD + body + TAIL, encoding="utf-8")
    print(json.dumps({"wrote": a.out, "bytes": len(HEAD + body + TAIL)}))


if __name__ == "__main__":
    main()
