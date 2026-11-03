# Flood Detection & Alert — JavaScript

This folder makes the pages work in the browser. **Accounts, flood reports,
confirmations, comments, flags, saved routes, travel schedules and
notifications are on the Flask server** (`accounts.py`, `reports_api.py`,
`community_api.py`, `routes_api.py`, `notifications_api.py`, SQLite). Only
"Remind me" reminders and the area-risk log are still kept
in `localStorage` (see `DATABASE.md`).

## How it is loaded

Every page has one line before `</body>`:

```html
<script src="../static/js/app.js"></script>          <!-- templates/*.html -->
<script src="../../static/js/app.js"></script>       <!-- templates/auth/*.html -->
```

`app.js` first loads `/api/auth/me.js` from the server (who is signed in: `window.FDA_ME`, and the CSRF token:
`window.FDA_CSRF`), `/api/reports.js` (the flood reports: `window.FDA_REPORTS`) and `/api/my.js` (your routes,
schedules, notifications, notification settings and watched barangays: `window.FDA_MY`), then `data/locations.js` and `core/*.js` in order, then `pages/<this-page-name>.js`.
Plain scripts (no modules). A page opened from disk (`file://`) still opens, but as a guest with no reports:
signing in and reports need the server.

## Accounts

There are no demo accounts. Create a user account on the register page.
Moderators are created by an administrator, from the `flood-detection` folder:

```
flask --app app create-user --moderator
```

**Guests can only view**: the map, weather, flood areas, reports and report details.
Reporting, confirming, commenting, flagging, routes, schedules and notifications need an account;
moderation needs a moderator account. Passwords are hashed on the server (Werkzeug), sessions use
Flask-Login, and every POST carries a CSRF token (Flask-WTF), which `core/api.js` adds.
There are no sample reports any more: report numbers start at #1 in the database.
To clear this browser's own data (reminders, the area-risk log), run `FDA.store.reset()` in the browser console.
Everything else stays on the server.

## Core files (`core/`)

| File           | What it does |
|----------------|--------------|
| `store.js`     | `db().reports`, `db().routes`, `db().schedules` come from the server (in memory). Change routes and schedules only with `saveRoute`, `setRouteAlert`, `deleteRoute`, `saveSchedule`, `setScheduleEnabled`, `markChecked`, `deleteSchedule` (each returns a Promise). Browser data (localStorage) for notifications and settings. |
| `api.js`       | `FDA.api.get / post` to the Flask server. Adds the CSRF token to every POST. |
| `geo.js`       | Reads the location list (see below), then does lookups, distances and "use my location". Add a geocoder for street-level addresses later. |
| `agent.js`     | **The intelligent agent**: thresholds, status, recommendation, duplicate check, route check, flood-risk outlook. Edit `FDA.agent.config` to tune. |
| `classifier.js`| Photo → flood probability. Uses the trained model through Flask (`/api/classify`) first, then a TensorFlow.js copy if present, otherwise a **demo estimate** (see below). |
| `auth.js`      | Register, sign in/out and roles, through the server (`/api/auth/*`). `FDA.auth.current()` reads `window.FDA_ME`. |
| `notify.js`    | In-app notifications and settings, on the server. `push()` only makes one for yourself (other people's are made by the server); checks for new ones once a minute. |
| `scheduler.js` | Pre-departure route checks. Runs while a page is open (a server would use APScheduler). |
| `ui.js`        | Badges, toasts, dialogs, form errors. |
| `layout.js`    | Runs on every page: sign-in guards, header avatar, bell count, bottom bar. |
| `routing.js`   | Street routes for My routes: OSRM public demo (driving), segments by street and barangay, 24 h cache. Change `FDA.routing.CONFIG.OSRM_URL` to use another server. |
| `routeDraft.js` | The map on My routes: shows the suggested street route and lets the person tap points to correct it, or draw freehand. Used by `pages/routes.js`. |

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

`classifier.js` tries these in order and uses the first one that works:

1. **Flask (the normal setup).** Put the trained MobileNetV2 at
   `models/flood_model.keras` (see `models/README.md`), install the requirements
   (Python 3.12 for TensorFlow) and run `flask --app app run`. The page checks
   `GET /api/model-status`, then sends each photo as a JPEG (longest side up to
   1024 px) to `POST /api/classify`, which returns `{"prob": 0..1, "source": "server"}`.
   If that request fails, the report still goes through with the demo estimate
   and a toast says so.
2. **TensorFlow.js (optional).** For running without Flask, convert the model:

   ```bash
   pip install tensorflowjs
   tensorflowjs_converter --input_format=keras flood_model.keras static/model/
   ```

   and serve the folder over http (for example `python -m http.server` from the
   repo root), because browsers do not let a page opened from disk load the model.
   The page passes raw 0–255 pixels at 224×224: the model has its own scaling
   layer, so do not scale them in the browser. If a model has two outputs, set
   `FDA.classifier.floodIndex` to the index of the "Flood" class in its training order.
3. **Demo estimate.** With neither, or from `file://`, the result is a rough
   colour-based estimate, not the trained model. The result page labels it "DEMO ESTIMATE".

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
| `core/weather.js` | Quezon City weather card and flood risk (low / moderate / high / severe from mm/h, 15 min cache); also drives the moderate-or-higher banner on the flood map |
| `core/areas.js` | Rule 2 area risk for all 142 barangays every 15 min, decision log, "Alert me" watch list |
| `core/agent.js` | Rule 1 (`checkPhoto`, cut-offs 0.80 / 0.50 / 0.30) and Rule 2 (`areaRisk`) |
| `core/mapkit.js`, `core/streets.js` | Leaflet loader and street exposure from OpenStreetMap |
| `pages/map.js`, `pages/areas.js` | Flood map and Flood areas pages |

## Flood hazard layer (real data)

| File | What it does |
| --- | --- |
| `static/data/qc-flood-hazard.geojson` | Per barangay: `name`, `district`, `risk`, `source`, `low` / `moderate` / `high` (% of the covered area), `coverage` |
| `static/data/qc-flood-hazard.js` | Generated script copy of the GeoJSON (a page opened from disk cannot read a .geojson file) |
| `core/hazardLayer.js` | Loads the data, draws the Leaflet layer, popup, tooltip and legend; shows an error if the data fails to load |
| `scripts/build_qc_flood_hazard.js` | Builds both data files from the LiPAD shapefile (Node, no packages) |

Source: UP DREAM / Phil-LiDAR 1 (LiPAD), City of Quezon 100 Year Flood Hazard Map (2016), 481.2 mm scenario.
`Var` 1 = Low, 2 = Medium (shown as Moderate), 3 = High; 0, -1 and -2 are never counted as hazard. Overlaps: highest class wins.
`risk` is the highest class covering at least 20% of the barangay's covered area (`RISK_SHARE` in the script).
`unknown` = too little of the barangay is covered by the data; `below-threshold` = covered, but no class reaches 20%.
To rebuild, put the shapefile (.shp .dbf .shx .prj) in `scripts/source/` (not committed) and run, from this `flood-detection` folder:

```
node scripts/build_qc_flood_hazard.js
```

The older "Flood hazard zones" layer (from `barangays.js`) has invented levels, is labelled SAMPLE and is off by default.

## Possible flooding (rain forecast x hazard map)

| File | What it does |
| --- | --- |
| `core/possibleFlooding.js` | The rules. Edit the `RULES` table at the top to change the thresholds' result. No map code. |
| `core/possibleFloodingLayer.js` | Map layer, popup, legend and the "highest level now" list (hidden below moderate) |

Rain = the peak mm/hour from now to the next 24 hours from `core/weather.js` (same cut-offs as the weather badge: 2.5 / 7.5 / 15),
one city-wide value for every barangay. Hazard = the barangay's level in `qc-flood-hazard.js`.
`unknown` hazard always gives `unknown`, never `low`. If the forecast or the hazard data cannot be loaded, the layer stays off and says why.
It is an estimate from a rule table, not a prediction and not an official warning.

## Known limits of this prototype

- Everything people share is on the server, including the flood-spot log. "Remind me" and the area-risk log still live in one browser.
- Pre-departure checks also run on the server once a minute (`jobs.py`); the 15-minute area rain check still needs a page open.
- The photo check and the agent's Rule 1 run in the page; the server checks the values it is sent but does not re-run them.
- Pre-departure checks and reminders only run while a page is open.
- The map is real (Leaflet + OpenStreetMap) and needs internet for tiles, streets (Overpass) and rain (Open-Meteo).
- Hazard levels and recurring flood spots are SAMPLE data until UP NOAH and real sightings are added (`static/data/`, rebuild with `scripts/build_barangays.py`).
- Three barangays (Capri, Greater Lagro, North Fairview) have approximate squares instead of real boundaries.
- Photos are shrunk to ~800 px in the browser, then saved on the server in `uploads/` as JPEG (EXIF, such as GPS, removed).
- Moderators reach the moderation page from the header on desktop; there is no phone link to it yet.
- There is no password reset or email/SMS yet. The location list covers Quezon City only.
