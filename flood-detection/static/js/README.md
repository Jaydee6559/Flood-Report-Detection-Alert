# Flood Detection & Alert — JavaScript

This folder makes the static pages work **in the browser, without a server**.
Everything the pages save (accounts, reports, comments, routes, schedules,
notifications) is kept in `localStorage`, so the prototype can be clicked
through end to end and demoed. When the Flask + SQLite backend exists, the
pages stay as they are and only `core/store.js` (plus a few calls in
`core/auth.js` and the page scripts) change to talk to the API.

## How it is loaded

Every page has one line before `</body>`:

```html
<script src="../static/js/app.js"></script>          <!-- templates/*.html -->
<script src="../../static/js/app.js"></script>       <!-- templates/auth/*.html -->
```

`app.js` loads `data/locations.js` and `core/*.js` in order, then `pages/<this-page-name>.js`.
Plain scripts (no modules), so pages still open from disk (`file://`).

## Demo accounts

| Role      | Email / number          | Password      |
|-----------|-------------------------|---------------|
| User      | `maria@example.com`     | `Flood123`    |
| Moderator | `moderator@example.com` | `Moderate123` |

You can also create an account on the register page. Guests can check photos,
read reports, use the map and see the weather; routes, schedules and
notifications need an account; moderation needs the moderator account.
To start over, run `FDA.store.reset()` in the browser console.
The sample reports, Maria's home (Tandang Sora) and her three routes are all in Quezon City.

## Core files (`core/`)

| File           | What it does |
|----------------|--------------|
| `store.js`     | The "database" (localStorage) and the sample data. Swap for the API later. |
| `geo.js`       | Reads the location list (see below), then does lookups, distances and "use my location". Add a geocoder for street-level addresses later. |
| `agent.js`     | **The intelligent agent**: thresholds, status, recommendation, duplicate check, route check, flood-risk outlook. Edit `FDA.agent.config` to tune. |
| `classifier.js`| Photo → flood probability. Uses a TensorFlow.js model if present, otherwise a **demo estimate** (see below). |
| `auth.js`      | Register, sign in/out, roles. Toy password hash, **demo only**. |
| `notify.js`    | In-app notifications and per-user settings. |
| `scheduler.js` | Pre-departure route checks. Runs while a page is open (a server would use APScheduler). |
| `ui.js`        | Badges, toasts, dialogs, form errors. |
| `layout.js`    | Runs on every page: sign-in guards, header avatar, bell count, bottom bar. |

## Locations (`static/data/`)

The place list is Quezon City only: 6 districts and its 142 barangays.

| File             | What it is |
|------------------|------------|
| `locations.json` | **The file to edit.** Cities, districts, barangays (with a centre point) and landmarks. |
| `locations.js`   | A generated copy of the JSON, wrapped as `window.FDA_LOCATIONS = {...}`. Pages load this one. |

Why two files: a page opened from disk (`file://`) is not allowed to read a
JSON file, but it can load a script. After editing `locations.json`, run

```
python3 scripts/build_locations.py
```

To add a barangay, add `{"name": "...", "district": 1, "lat": 14.6, "lng": 121.0}` to the
city's `barangays` list. To add another city, add another object to `cities`
with the same shape. The drop-downs, search and route matching pick it up with no code changes.

Notes on the data: barangay names and districts follow the Wikipedia list of
barangays in Quezon City (checked against the PSGC list). The coordinates are
approximate centres taken from the middle of each barangay's boundary, so they
are fine for matching reports to routes but are not exact addresses. Capri,
Greater Lagro and North Fairview had no boundary in the source, so they use the
centre of their district and carry `"approx": true`.

## Page files (`pages/`)

`login`, `register`, `index` (home), `report`, `result`, `reports`,
`report-details`, `map`, `routes`, `schedules`, `notifications`,
`moderation`, `weather`.

## The image model

`classifier.js` looks for a TensorFlow.js model at `static/model/model.json`.
To use your trained MobileNetV2:

```bash
pip install tensorflowjs
tensorflowjs_converter --input_format=keras flood_model.keras static/model/
```

Then serve the folder over http (for example `python -m http.server` from the
repo root) because browsers do not let a page opened from disk load the model.
Preprocessing is `[-1, 1]` scaling at 224×224, which is MobileNetV2's default.
If your model has two outputs, set `FDA.classifier.floodIndex` to the index of
the "Flood" class in your training order.

**Until then the result is a rough colour-based demo estimate**, not the trained
model. The result page labels it "DEMO ESTIMATE".

## Weather

`pages/weather.js` calls the free [Open-Meteo](https://open-meteo.com) forecast
API (no key). The rainfall level shown is estimated from the forecast with
PAGASA's levels (yellow 7.5, orange 15, red 30 mm/h) and is labelled as an
estimate, **not** an official PAGASA advisory. If the API cannot be reached the
page keeps its sample data and says so.

## Flood map, areas and the agent rules

| File | What it does |
| --- | --- |
| `core/hazard.js` | Barangay polygons, hazard level, point-in-polygon, recurring flood spots (the H and S inputs) |
| `core/rain.js` | Rain now and +1..+3 h per district from Open-Meteo, PAGASA levels, demo storm (the R input) |
| `core/areas.js` | Rule 2 area risk for all 142 barangays every 15 min, decision log, "Alert me" watch list |
| `core/agent.js` | Rule 1 (`checkPhoto`, cut-offs 0.80 / 0.50 / 0.30) and Rule 2 (`areaRisk`) |
| `core/mapkit.js`, `core/streets.js` | Leaflet loader and street exposure from OpenStreetMap |
| `pages/map.js`, `pages/areas.js` | Flood map and Flood areas pages |

## Known limits of this prototype

- Data lives in one browser; other people and devices cannot see it.
- Pre-departure checks and reminders only run while a page is open.
- The map is real (Leaflet + OpenStreetMap) and needs internet for tiles, streets (Overpass) and rain (Open-Meteo).
- Hazard levels and recurring flood spots are SAMPLE data until UP NOAH and real sightings are added (`static/data/`, rebuild with `scripts/build_barangays.py`).
- Three barangays (Capri, Greater Lagro, North Fairview) have approximate squares instead of real boundaries.
- Photos are shrunk to ~800 px and stored in the browser (about 5 MB total).
- Moderators reach the moderation page from the header on desktop; there is no phone link to it yet.
- Password reset, real email/SMS needs the backend. The location list covers Quezon City only.
