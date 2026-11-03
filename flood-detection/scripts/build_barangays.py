#!/usr/bin/env python3
"""
Build static/data/barangays.geojson (+ barangays.js) for the flood map.

Source polygons: github.com/faeldon/philippines-json-maps
  2011/geojson/barangays/medres/barangays-municity-963-quezoncity.0.01.json
Names are matched to static/data/locations.json (the file the rest of the app uses).
Greater Lagro and North Fairview have no polygon in the source, so they get a small
square around their centre point and carry "approx": true.

Hazard: the level of each barangay comes from static/data/qc-flood-hazard.geojson (the UP DREAM /
Phil-LiDAR 1 City of Quezon 100 Year Flood Hazard Map, 2016), mapped as in scripts/apply_qc_hazard.py.
The hand-made lists below are only a fallback for a barangay that file does not have.

Usage:  python3 scripts/build_barangays.py path/to/barangays-municity-963-quezoncity.0.01.json
"""
import json, pathlib, re, sys, unicodedata

here = pathlib.Path(__file__).resolve().parent.parent / "static" / "data"
src = pathlib.Path(sys.argv[1])

ALIAS = {  # locations.json name -> source NAME_3
    "Balon Bato": "Balong Bato", "St. Ignatius": "Saint Ignatius", "Doña Aurora": "Aurora", "New Era": "Constitution Hills",
    "San Isidro Galas": "San Isidro", "Santo Domingo (Matalahib)": "Matalahib", "Siena": "Sienna",
    "Teacher's Village East": "Teachers Village East", "Teacher's Village West": "Teachers Village West",
}

# FALLBACK only (hand-made, not real data): used for a barangay missing from qc-flood-hazard.geojson.
HIGH = ["Santo Domingo (Matalahib)", "Doña Imelda", "Talayan", "Apolonio Samson", "Masambong", "Tatalon", "Sienna",
        "Siena", "Damayang Lagi", "Maharlika", "Bagong Silangan", "Culiat", "Tandang Sora", "Baesa", "Sauyo", "Balingasa",
        "San Jose", "Mariblo", "Paang Bundok", "Pasong Tamo", "Santa Cruz", "Nagkaisang Nayon", "Bahay Toro"]
MEDIUM = ["Sangandaan", "Veterans Village", "Project 6", "Vasra", "Old Capitol Site", "Kamuning", "Kaunlaran", "Roxas",
          "Sacred Heart", "Don Manuel", "Laging Handa", "Pinyahan", "Valencia", "Blue Ridge A", "Blue Ridge B",
          "Escopa I", "Escopa II", "Escopa III", "Escopa IV", "Libis", "Loyola Heights", "Matandang Balara",
          "Pansol", "Holy Spirit", "Batasan Hills", "Commonwealth", "Payatas", "Novaliches Proper", "Gulod",
          "Pasong Putik Proper", "Greater Lagro", "North Fairview", "Fairview", "San Agustin", "Capri", "Santa Lucia",
          "Santa Monica", "Nova Proper", "Bagbag", "Kaligayahan", "Talipapa", "Unang Sigaw", "Sta. Teresita",
          "Sto. Niño", "Immaculate Concepcion", "Quirino 2-A", "Quirino 2-B", "Quirino 2-C", "Ugong Norte",
          "Bagumbayan", "Mangga", "Duyan-duyan", "Socorro", "Silangan", "Marilag", "Milagrosa"]
NONE = ["U.P. Campus", "U.P. Village", "Teachers Village East", "Teacher's Village East", "Teacher's Village West",
        "Teachers Village West", "Central", "Bahay Toro Heights"]

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", "", s); s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\bsta\b", "santa", s); s = re.sub(r"\bsto\b", "santo", s)
    return re.sub(r"\s+", " ", s).strip()

H = {}
for lvl, names in (("high", HIGH), ("medium", MEDIUM), ("none", NONE)):
    for n in names: H[norm(n)] = lvl

QC_HAZARD = here / "qc-flood-hazard.geojson"
QC_LEVEL = {"high": "high", "moderate": "medium", "low": "low", "below-threshold": "low", "unknown": "low"}   # as apply_qc_hazard.py
REAL = {}
if QC_HAZARD.exists():
    for f in json.loads(QC_HAZARD.read_text(encoding="utf-8"))["features"]:
        REAL[norm(f["properties"]["name"])] = QC_LEVEL.get(f["properties"].get("risk"), "low")

def hazard_of(name):
    k = norm(name)
    return REAL.get(k) or H.get(k, "low")

loc = json.loads((here / "locations.json").read_text(encoding="utf-8"))["cities"][0]
poly = {norm(f["properties"]["NAME_3"]): f for f in json.loads(src.read_text(encoding="utf-8"))["features"]}

def r5(c):
    return [r5(x) for x in c] if isinstance(c[0], list) else [round(c[0], 5), round(c[1], 5)]

feats, missing = [], []
for b in loc["barangays"]:
    key = norm(ALIAS.get(b["name"], b["name"]))
    f = poly.get(key)
    props = {"name": b["name"], "district": b["district"], "lat": b["lat"], "lng": b["lng"], "hazard": hazard_of(b["name"])}
    if f and f.get("geometry"):
        geom = {"type": f["geometry"]["type"], "coordinates": r5(f["geometry"]["coordinates"])}
    else:
        d = 0.0045  # ~500 m square around the centre
        la, ln = b["lat"], b["lng"]
        geom = {"type": "Polygon", "coordinates": [[[ln - d, la - d], [ln + d, la - d], [ln + d, la + d], [ln - d, la + d], [ln - d, la - d]]]}
        props["approx"] = True; missing.append(b["name"])
    feats.append({"type": "Feature", "properties": props, "geometry": geom})

out = {"type": "FeatureCollection", "_about": "Quezon City barangays. Hazard level per barangay from the UP DREAM / Phil-LiDAR 1 City of Quezon 100 Year Flood Hazard Map (2016); see scripts/apply_qc_hazard.py.", "features": feats}
(here / "barangays.geojson").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
(here / "barangays.js").write_text("/* GENERATED by scripts/build_barangays.py */\nwindow.FDA_BARANGAYS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
print(len(feats), "barangays; approximate squares for:", missing)
