/**
 * Flood hazard and recurring flood spots (the agent's H and S inputs)
 *
 * Data:
 *   static/data/barangays.js    142 barangay polygons with a hazard level (SAMPLE levels until the
 *                               UP NOAH layer is plugged in; see scripts/build_barangays.py)
 *   static/data/flood-spots.js  the flood-spot log seed (SAMPLE). Moderators add more in the browser.
 *
 * Everything here is read-only lookups, so it can move to the Flask API later without changing callers:
 *   FDA.hazard.at(lat, lng)            -> {barangay, hazard} for a point
 *   FDA.hazard.of("Culiat")            -> "high" | "medium" | "low" | "none"
 *   FDA.hazard.spots()                 -> every recurring spot (seed + log)
 *   FDA.hazard.spotsNear(p, meters)    -> spots within a radius of p
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var GJ = window.FDA_BARANGAYS;
  if (!GJ || !GJ.features) {
    if (window.console) console.error("static/data/barangays.js is missing. Run: python3 scripts/build_barangays.py <source.json>");
    GJ = { features: [] };
  }

  var ORDER = { none: 0, low: 1, medium: 2, high: 3 };
  var LABEL = { none: "No hazard zone", low: "Low hazard", medium: "Medium hazard", high: "High hazard" };
  var DEPTH = {
    gutter: { label: "Gutter deep", rank: 1 }, tire: { label: "Tire deep", rank: 2 },
    knee: { label: "Knee deep", rank: 3 }, waist: { label: "Waist deep", rank: 4 }
  };
  var PASS = { all: "All vehicles", "light-no": "Light vehicles cannot pass", none: "No vehicles" };

  /* ---------- Barangays: bounding boxes for fast point-in-polygon ---------- */
  var byName = {}, list = [];
  GJ.features.forEach(function (f) {
    var rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    var minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    rings.forEach(function (poly) { poly[0].forEach(function (c) {
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0];
    }); });
    var p = f.properties;
    var b = { name: p.name, district: p.district, hazard: p.hazard, lat: p.lat, lng: p.lng, approx: !!p.approx, feature: f, rings: rings,
      bbox: [minLat, minLng, maxLat, maxLng] };
    byName[p.name] = b; list.push(b);
  });

  function inRing(lat, lng, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inBarangay(b, lat, lng) {
    if (lat < b.bbox[0] || lat > b.bbox[2] || lng < b.bbox[1] || lng > b.bbox[3]) return false;
    for (var i = 0; i < b.rings.length; i++) {
      if (!inRing(lat, lng, b.rings[i][0])) continue;
      var hole = false;
      for (var h = 1; h < b.rings[i].length; h++) if (inRing(lat, lng, b.rings[i][h])) hole = true;
      if (!hole) return true;
    }
    return false;
  }

  /* ---------- Flood spots ---------- */
  var cache = null, cacheKey = "";
  function logged() { var db = FDA.store.db(); return (db.spots = db.spots || []); }

  function metersToDeg(dn, de, lat) { return { lat: dn / 111320, lng: de / (111320 * Math.cos(lat * Math.PI / 180)) }; }

  function build() {
    var key = (window.FDA_SPOTS || []).length + ":" + logged().length;
    if (cache && key === cacheKey) return cache;
    var out = [];
    (window.FDA_SPOTS || []).forEach(function (s, i) {
      var b = byName[s.b]; if (!b) return;
      var d = metersToDeg(s.dn || 0, s.de || 0, b.lat);
      out.push({ id: "s" + (i + 1), barangay: s.b, corner: s.corner, street: s.street || "", times: s.n, depth: s.depth, pass: s.pass, last: s.last, lat: b.lat + d.lat, lng: b.lng + d.lng, source: s.src, seed: true });
    });
    logged().forEach(function (s) { out.push(Object.assign({ seed: false }, s)); });
    cache = out; cacheKey = key;
    return out;
  }

  function distance(a, b) { return FDA.geo.distance(a, b); }

  FDA.hazard = {
    isSample: true,   // set to false when the UP NOAH hazard layer replaces the sample levels
    order: ORDER, label: function (h) { return LABEL[h] || LABEL.none; },
    depth: function (d) { return DEPTH[d] || { label: d || "", rank: 0 }; },
    pass: function (p) { return PASS[p] || ""; },
    DEPTHS: DEPTH, PASSES: PASS,
    /** True when level a is at least as bad as level b. */
    atLeast: function (a, b) { return ORDER[a] >= ORDER[b]; },

    barangays: function () { return list; },
    /** True when the point is inside that barangay's polygon. */
    contains: function (name, lat, lng) { return !!byName[name] && inBarangay(byName[name], lat, lng); },
    get: function (name) { return byName[name] || null; },
    of: function (name) { return byName[name] ? byName[name].hazard : "none"; },
    geojson: function () { return GJ; },

    /** The barangay (and its hazard level) that contains a point, or null. */
    at: function (lat, lng) {
      for (var i = 0; i < list.length; i++) if (inBarangay(list[i], lat, lng)) return { barangay: list[i].name, hazard: list[i].hazard, district: list[i].district };
      var n = FDA.geo.nearest(lat, lng);   // outside every polygon (river, border): fall back to the closest centre
      return n && n.meters < 1500 ? { barangay: n.barangay, hazard: byName[n.barangay] ? byName[n.barangay].hazard : "none", district: byName[n.barangay] ? byName[n.barangay].district : null, approx: true } : null;
    },

    spots: function () { return build(); },
    spotsIn: function (barangay) { return build().filter(function (s) { return s.barangay === barangay; }); },
    spotsNear: function (p, meters) { return build().filter(function (s) { return distance(p, s) <= meters; }); },
    /** Spots whose street name matches (for the street card on the map). */
    spotsOnStreet: function (barangay, street) {
      var k = String(street || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!k) return [];
      return build().filter(function (s) {
        var a = String(s.street || "").toLowerCase().replace(/[^a-z0-9]/g, ""), c = String(s.corner || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return (!barangay || s.barangay === barangay) && (a === k || a.indexOf(k) >= 0 || k.indexOf(a) >= 0 && a || c.indexOf(k) >= 0);
      });
    },
    worstDepth: function (spots) {
      var best = null;
      spots.forEach(function (s) { if (!best || FDA.hazard.depth(s.depth).rank > FDA.hazard.depth(best.depth).rank) best = s; });
      return best;
    },

    /** Moderators: add a sighting to the log. Returns the new spot. */
    addSpot: function (o) {
      var b = byName[o.barangay]; if (!b) throw new Error("Choose a barangay from the list.");
      var p = FDA.geo.point("Quezon City", o.barangay, o.corner) || { lat: b.lat, lng: b.lng };
      var db = FDA.store.db(), spot = {
        id: "L" + Date.now().toString(36), barangay: o.barangay, corner: o.corner, street: o.street || o.corner.split(/ cor\.? /i)[0],
        times: 1, depth: o.depth, pass: o.pass || "all", last: o.date, lat: p.lat, lng: p.lng, source: o.source || "Moderator log", sourceUrl: o.url || ""
      };
      // the same corner seen again counts as another time instead of a second row
      var same = logged().filter(function (s) { return s.barangay === spot.barangay && s.corner.toLowerCase() === spot.corner.toLowerCase(); })[0];
      if (same) { same.times += 1; same.last = spot.last > same.last ? spot.last : same.last; if (FDA.hazard.depth(spot.depth).rank > FDA.hazard.depth(same.depth).rank) same.depth = spot.depth; FDA.store.save(); cache = null; return same; }
      db.spots.push(spot); FDA.store.save(); cache = null; return spot;
    },
    removeSpot: function (id) { var db = FDA.store.db(); db.spots = logged().filter(function (s) { return s.id !== id; }); FDA.store.save(); cache = null; }
  };
})();
