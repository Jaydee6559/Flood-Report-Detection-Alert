# Flood Detection & Alert — JavaScript

This folder makes the pages work in the browser. **Accounts, flood reports,
confirmations, comments, flags, saved routes, travel schedules and
notifications are on the Flask server** (`accounts.py`, `reports_api.py`,
`community_api.py`, `routes_api.py`, `notifications_api.py`, `spots_api.py`, SQLite),
and so are "Remind me" reminders, the flood-spot log and the area-risk log. The server also
runs the timed checks (`jobs.py`), so alerts go out with no page open (see `DATABASE.md`).

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
To clear this browser's own copy (anything still waiting to be sent to the server), run `FDA.store.reset()` in the browser console.
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

The "Hazard level used by the agent" layer (from `barangays.js`) shows the high / medium / low level the agent uses for each barangay, taken from the same 100-year map by `scripts/apply_qc_hazard.py`. It is off by default.

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

- Everything is on the server. The pre-departure check, reminders and the 15-minute area rain check run there too (`jobs.py`).
- A "Simulated storm" (map) only exists in one browser; its area alerts are made by that page and say so.
- The photo check and the agent's Rule 1 run in the page first, so the result shows at once. The server then re-checks the photo with the trained model (when it is loaded) and runs Rule 1 again with its own hazard map, flood spots, nearby reports and live rain (`agent.py`); the server's result is the one saved. When the server has no live rain from the last 30 minutes it uses the page's rain level and logs that (`rainSource: "page"`).
- Pre-departure checks and reminders run on the server once a minute while `flask run` is running (`jobs.py`), even with no page open. Open pages also run them, using the same notification keys, so nothing is sent twice.
- The map is real (Leaflet + OpenStreetMap) and needs internet for tiles, streets (Overpass) and rain (Open-Meteo).
- Hazard levels come from the UP DREAM / Phil-LiDAR 1 100-year flood hazard map (2016); after rebuilding `qc-flood-hazard.geojson`, run `python scripts/apply_qc_hazard.py`. The 40 starting recurring flood spots (`static/data/flood-spots.js`) are SAMPLE data. Load real QCDRRMO / MMDA sightings with `flask --app app import-spots spots.csv` (or add them on the moderation page), then run `flask --app app sample-spots off` so only real spots count.
- Three barangays (Capri, Greater Lagro, North Fairview) have approximate squares instead of real boundaries.
- Photos are shrunk to ~800 px in the browser, then saved on the server in `uploads/` as JPEG (EXIF, such as GPS, removed).
- Moderators reach the moderation page from the header link on desktop and from the shield button next to the bell on phones.
- "Forgot password?" sends a 6-digit code by email when `MAIL_SERVER` is set; without it (and for mobile-number accounts, as there is no SMS service yet) the code is printed in the server console. The location list covers Quezon City only.
