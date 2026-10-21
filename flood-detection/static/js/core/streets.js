/**
 * Streets of one barangay from OpenStreetMap (Overpass API), scored by flood hazard.
 *
 *   FDA.streets.load("Culiat") -> Promise<{streets:[{name, highway, lines, lengthM, pct, highPct, max}], source}>
 *   FDA.streets.names("Culiat") -> Promise<string[]>   street names for the report form
 *
 * "pct" is the share of a street's length that lies in a medium or high hazard zone (sample hazard
 * levels until UP NOAH is added). Streets are loaded only for the barangay you open, which keeps the map fast.
 * OSM street names are patchy in places; if the service is busy the call fails with a readable message.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  var memory = {}, pending = {};
  var RANK = { none: 0, low: 1, medium: 2, high: 3 };

  function query(b) {
    var bb = b.bbox;
    return '[out:json][timeout:25];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"]["name"](' +
      bb[0] + "," + bb[1] + "," + bb[2] + "," + bb[3] + ");out tags geom;";
  }

  function post(url, body) {
    var ctl = window.AbortController ? new AbortController() : null, t = ctl && setTimeout(function () { ctl.abort(); }, 30000);
    return fetch(url, { method: "POST", body: "data=" + encodeURIComponent(body), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error("Street service returned " + r.status); return r.json(); });
  }

  function fetchOverpass(body) {
    return post(ENDPOINTS[0], body).catch(function () { return post(ENDPOINTS[1], body); })
      .catch(function () { throw new Error("Streets could not be loaded right now (the OpenStreetMap service is busy or offline). Try again in a minute."); });
  }

  function build(name, data) {
    var b = FDA.hazard.get(name), groups = {};
    (data.elements || []).forEach(function (w) {
      if (!w.geometry || w.geometry.length < 2 || !w.tags || !w.tags.name) return;
      var pts = w.geometry.map(function (g) { return [g.lat, g.lon]; });
      // keep ways that touch this barangay
      if (!pts.some(function (p) { return FDA.hazard.contains(name, p[0], p[1]); })) return;
      var key = w.tags.name, g = groups[key] = groups[key] || { name: key, highway: w.tags.highway, lines: [], lengthM: 0, hiM: 0, highM: 0, max: "none" };
      g.lines.push(pts);
      for (var i = 0; i < pts.length - 1; i++) {
        var a = { lat: pts[i][0], lng: pts[i][1] }, c = { lat: pts[i + 1][0], lng: pts[i + 1][1] };
        var len = FDA.geo.distance(a, c), mid = FDA.hazard.at((a.lat + c.lat) / 2, (a.lng + c.lng) / 2), hz = mid ? mid.hazard : "none";
        g.lengthM += len;
        if (hz === "medium" || hz === "high") g.hiM += len;
        if (hz === "high") g.highM += len;
        if (RANK[hz] > RANK[g.max]) g.max = hz;
      }
    });
    var out = Object.keys(groups).map(function (k) {
      var g = groups[k];
      return { name: g.name, highway: g.highway, lines: g.lines, lengthM: Math.round(g.lengthM), pct: g.lengthM ? Math.round(100 * g.hiM / g.lengthM) : 0, highPct: g.lengthM ? Math.round(100 * g.highM / g.lengthM) : 0, max: g.max };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, "en"); });
    try { localStorage.setItem("fda.street-names." + name, JSON.stringify(out.map(function (s) { return s.name; }))); } catch (e) { /* storage full: names are re-fetched next time */ }
    return { streets: out, source: "OpenStreetMap" };
  }

  FDA.streets = {
    load: function (name) {
      var b = FDA.hazard.get(name);
      if (!b) return Promise.reject(new Error("Unknown barangay."));
      if (memory[name]) return Promise.resolve(memory[name]);
      if (pending[name]) return pending[name];
      pending[name] = fetchOverpass(query(b)).then(function (data) { memory[name] = build(name, data); return memory[name]; })
        .then(function (r) { delete pending[name]; return r; }, function (e) { delete pending[name]; throw e; });
      return pending[name];
    },
    names: function (name) {
      return FDA.streets.load(name).then(function (r) { return r.streets.map(function (s) { return s.name; }); }).catch(function () {
        try { return JSON.parse(localStorage.getItem("fda.street-names." + name)) || []; } catch (e) { return []; }
      });
    },
    /** Middle point of a street (for centring the pin when a street is picked). */
    center: function (street) {
      var l = street.lines.slice().sort(function (a, b) { return b.length - a.length; })[0], p = l[Math.floor(l.length / 2)];
      return { lat: p[0], lng: p[1] };
    },
    /** Bin used for the legend and colours. */
    bin: function (pct) { return pct > 50 ? "over50" : pct >= 20 ? "mid" : pct > 0 ? "under20" : "none"; },
    COLORS: { over50: "#c0392b", mid: "#e67e22", under20: "#d4ac0d", none: "#8597a8" }
  };
})();
