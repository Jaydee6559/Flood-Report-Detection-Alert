/**
 * Street routing for saved routes (OSRM public demo server, driving profile)
 *
 *   FDA.routing.plan([{lat,lng}, {lat,lng}, ...]) -> Promise<{geometry, segments, distanceM}>
 *     geometry  [[lat,lng], ...]   the whole route along real streets
 *     segments  [{street, barangay, lines:[[lat,lng], ...], lengthM}]
 *               one segment per street inside one barangay (a long street that crosses barangays is split there)
 *   FDA.routing.freehand(stops) -> Promise<{geometry, segments, distanceM}>   a hand-drawn line (no street snapping, no routing server)
 *   FDA.routing.stopsOf(route)  -> [start, end] points of a saved route, or null
 *   FDA.routing.ensure(route)   -> Promise<route>  plans and stores geometry for a route that has none
 *
 * The OSRM demo server is for light use only (no uptime promise, rate limited), so answers are cached in
 * localStorage for 24 hours by stop coordinates. It only knows the driving profile, so a walking route
 * may differ. Street names are the OpenStreetMap names OSRM returns; where OSM has none the segment is
 * "Unnamed road". Each segment's barangay comes from FDA.hazard.at() on the middle of each small piece.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var CONFIG = {
    OSRM_URL: "https://router.project-osrm.org",   // base URL of the routing service
    PROFILE: "driving",
    TIMEOUT_MS: 15000,
    CACHE_HOURS: 24,
    PIECE_M: 100                                   // long straight pieces are checked every ~100 m for barangay changes
  };
  var CACHE = "fda.route.v1.";

  function key(stops) {
    return CACHE + stops.map(function (p) { return p.lat.toFixed(5) + "," + p.lng.toFixed(5); }).join("|");
  }
  function readCache(k) {
    try {
      var c = JSON.parse(localStorage.getItem(k));
      if (c && c.at && Date.now() - c.at < CONFIG.CACHE_HOURS * 3600000) return c.data;
    } catch (e) { /* ignore */ }
    return null;
  }
  function writeCache(k, data) {
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data: data })); }
    catch (e) { /* storage full: the route is simply asked for again next time */ }
  }

  function fetchRoute(stops) {
    var coords = stops.map(function (p) { return p.lng.toFixed(6) + "," + p.lat.toFixed(6); }).join(";");
    var url = CONFIG.OSRM_URL + "/route/v1/" + CONFIG.PROFILE + "/" + coords + "?overview=full&geometries=geojson&steps=true&continue_straight=true";   // no U-turns at points the user added
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, CONFIG.TIMEOUT_MS);
    return fetch(url, { signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (r.status === 429) throw new Error("The route service is busy (too many requests). Please try again in a minute.");
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (data.code === "NoRoute") throw new Error("No street route was found between those two places.");
        if (data.code === "NoSegment") throw new Error("One of the places is too far from a street to route from. Pick a street or a nearby barangay.");
        if (!r.ok || data.code !== "Ok" || !data.routes || !data.routes.length) throw new Error("The route service could not find a route (" + (data.code || r.status) + "). Please try again.");
        return data.routes[0];
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw new Error(err && err.name === "AbortError"
        ? "The route service took too long to answer. Please try again."
        : "The route service could not be reached. Check your internet connection and try again.");
    });
  }

  /** Points of a polyline with extra points added so no piece is longer than PIECE_M. */
  function densify(pts) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], len = FDA.geo.distance({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
      var n = Math.ceil(len / CONFIG.PIECE_M);
      for (var k = 1; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      out.push(b);
    }
    return out;
  }
  function r5(v) { return Math.round(v * 1e5) / 1e5; }

  /** OSRM route -> {geometry, segments, distanceM}. */
  function build(route) {
    var geometry = route.geometry.coordinates.map(function (c) { return [r5(c[1]), r5(c[0])]; });
    var segments = [];
    route.legs.forEach(function (leg) {
      leg.steps.forEach(function (step) {
        if (!step.geometry || step.geometry.coordinates.length < 2) return;
        var street = step.name || "Unnamed road";
        var pts = densify(step.geometry.coordinates.map(function (c) { return [r5(c[1]), r5(c[0])]; }));
        var cur = null;
        for (var i = 1; i < pts.length; i++) {
          var a = pts[i - 1], b = pts[i];
          var at = FDA.hazard.at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          var brgy = at ? at.barangay : "Outside the mapped barangays";
          var last = segments[segments.length - 1];
          if (!cur) {
            // continue the previous segment when the road and barangay are the same (OSRM often splits one road into several steps)
            cur = last && last.street === street && last.barangay === brgy ? last : { street: street, barangay: brgy, lines: [a], lengthM: 0 };
            if (cur !== last) segments.push(cur);
            else if (cur.lines[cur.lines.length - 1][0] !== a[0] || cur.lines[cur.lines.length - 1][1] !== a[1]) cur.lines.push(a);
          } else if (cur.barangay !== brgy) {
            cur = { street: street, barangay: brgy, lines: [a], lengthM: 0 };
            segments.push(cur);
          }
          cur.lines.push(b);
          cur.lengthM += FDA.geo.distance({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
        }
      });
    });
    segments.forEach(function (s) { s.lengthM = Math.round(s.lengthM); });
    return { geometry: geometry, segments: segments, distanceM: Math.round(route.distance) };
  }

  /** A hand-drawn line: the taps joined by straight lines. Streets are named from the nearest OpenStreetMap street. */
  var NAME_M = 35, NAME_WAIT_MS = 6000;   // a piece of line this close to a street is named after it
  function freehand(stops) {
    var pts = densify(stops.map(function (p) { return [r5(p.lat), r5(p.lng)]; })), pieces = [], barangays = {};
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], mid = { lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2 }, at = FDA.hazard.at(mid.lat, mid.lng);
      var brgy = at ? at.barangay : "Outside the mapped barangays";
      pieces.push({ a: a, b: b, mid: mid, barangay: brgy });
      if (at) barangays[brgy] = true;
    }
    var names = Object.keys(barangays);
    // Street names are a bonus: if OpenStreetMap is slow, the line is returned unnamed after a few seconds
    function streetsOf(n) {
      var slow = new Promise(function (ok) { setTimeout(function () { ok([]); }, NAME_WAIT_MS); });
      return Promise.race([FDA.streets.load(n).then(function (r) { return r.streets; }, function () { return []; }), slow]);
    }
    return Promise.all(names.map(streetsOf)).then(function (lists) {
      var byBarangay = {}; names.forEach(function (n, k) { byBarangay[n] = lists[k]; });
      var segments = [], cur = null;
      pieces.forEach(function (pc) {
        var best = Infinity, street = "Unnamed road";
        (byBarangay[pc.barangay] || []).forEach(function (st) {
          st.lines.forEach(function (line) {
            for (var k = 1; k < line.length; k++) {
              var d = FDA.geo.toSegment(pc.mid, { lat: line[k - 1][0], lng: line[k - 1][1] }, { lat: line[k][0], lng: line[k][1] });
              if (d < best) { best = d; if (d <= NAME_M) street = st.name; }
            }
          });
        });
        if (best > NAME_M) street = "Unnamed road";
        if (!cur || cur.street !== street || cur.barangay !== pc.barangay) { cur = { street: street, barangay: pc.barangay, lines: [pc.a], lengthM: 0 }; segments.push(cur); }
        cur.lines.push(pc.b);
        cur.lengthM += FDA.geo.distance({ lat: pc.a[0], lng: pc.a[1] }, { lat: pc.b[0], lng: pc.b[1] });
      });
      segments.forEach(function (sg) { sg.lengthM = Math.round(sg.lengthM); });
      return { geometry: pts, segments: segments, distanceM: segments.reduce(function (t, sg) { return t + sg.lengthM; }, 0) };
    });
  }

  function validStops(stops) {
    return Array.isArray(stops) && stops.length >= 2 && stops.every(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); });
  }

  /** A saved route's start and end as {lat, lng, ...}. Older routes only have text, so it is looked up. */
  function stopsOf(route) {
    function one(point, text) {
      if (point && isFinite(point.lat) && isFinite(point.lng)) return point;
      var r = FDA.geo.resolve(text);
      if (!r) return null;
      var pt = { barangay: r.barangay || null, street: "", lat: r.lat, lng: r.lng };
      if (r.name !== r.barangay) pt.name = r.name;   // a landmark, not just a barangay
      return pt;
    }
    var a = one(route.startPoint, route.start), b = one(route.endPoint, route.end);
    return a && b ? [a, b] : null;
  }

  FDA.routing = {
    CONFIG: CONFIG,

    plan: function (stops) {
      if (!validStops(stops)) return Promise.reject(new Error("Pick a start point and a destination first."));
      var k = key(stops), hit = readCache(k);
      if (hit) return Promise.resolve(hit);
      return fetchRoute(stops).then(function (route) {
        var out = build(route);
        writeCache(k, out);
        return out;
      });
    },

    freehand: function (stops) {
      if (!validStops(stops)) return Promise.reject(new Error("Pick a start point and a destination first."));
      return freehand(stops);
    },

    stopsOf: stopsOf,

    /** Stores geometry and segments on a route that has none (older saved routes). */
    ensure: function (route) {
      if (route.geometry && route.geometry.length > 1) return Promise.resolve(route);
      var stops = stopsOf(route);
      if (!stops) return Promise.reject(new Error("We could not find the start or destination on the map. Edit the route and pick them again."));
      return FDA.routing.plan(stops).then(function (p) {
        route.startPoint = stops[0]; route.endPoint = stops[1];
        route.geometry = p.geometry; route.segments = p.segments; route.distanceM = p.distanceM;
        FDA.store.save();
        return route;
      });
    }
  };
})();
