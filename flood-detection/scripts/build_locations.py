#!/usr/bin/env python3
"""
Rebuild static/data/locations.js from static/data/locations.json.

locations.json is the file you edit. Browsers do not let a page opened from
disk (file://) read a JSON file, so the pages load locations.js, a copy of the
same data wrapped in a script. Run this after every change to the JSON:

    python3 scripts/build_locations.py
"""
import json, pathlib

root = pathlib.Path(__file__).resolve().parent.parent / "static" / "data"
data = json.loads((root / "locations.json").read_text(encoding="utf-8"))

text = (
    "/* GENERATED from locations.json by scripts/build_locations.py. Do not edit by hand. */\n"
    "window.FDA_LOCATIONS = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
)
(root / "locations.js").write_text(text, encoding="utf-8")
n = sum(len(c["barangays"]) for c in data["cities"])
print(f"locations.js written: {len(data['cities'])} city, {n} barangays")
