/**
 * Rain now and the next 3 hours (the agent's R input)
 *
 * One Open-Meteo call for the 6 district centres (free, no key), cached for 15 minutes.
 * Every barangay uses the rain of its district, because the forecast grid is a few km wide
 * and a district is as fine as the data gets. PAGASA levels: yellow 7.5, orange 15, red 30 mm/h.
 * These levels are worked out from forecast data and are NOT an official PAGASA warning.
 *
 * Modes (FDA.rain.mode()):
 *   "live"       real Open-Meteo data
 *   "sample"     the service could not be reached, so a made-up rainy evening is used
 *   "simulated"  the person chose "Demo rain: yellow/orange/red" so Rule 2 can be shown on a dry day
 *
 *   FDA.rain.load()                -> Promise<snapshot>   (also fires window event "fda:rain")
 *   FDA.rain.mm(district, hours)   -> mm per hour, hours = 0..3
 *   FDA.rain.level(district, hours)-> null | "yellow" | "orange" | "red"
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var CITY = "Quezon City", KEY = "fda.rain.v1", SIM = "fda.rain.sim", TTL = 15 * 60000;

  // Evening in the design: heavy rain in District 1, lighter elsewhere (mm/h now) and how it changes over 3 hours
  var BASE = { 1: 18, 4: 12, 6: 9, 3: 5, 5: 4, 2: 4 };
  var CURVE = [1, 1.25, 0.9, 0.55];
  var SCALE = { yellow: 0.5, orange: 1, red: 2 };

  var snap = null, loading = null;

  function districts() { return FDA.geo.districts(CITY); }

  function scenario(scale, source) {
    var d = {};
    districts().forEach(function (x) {
      d[x.id] = { mm: CURVE.map(function (c) { return Math.round((BASE[x.id] || 3) * scale * c * 10) / 10; }) };
    });
    return { at: Date.now(), source: source, districts: d };
  }

  function simLevel() { try { return localStorage.getItem(SIM) || ""; } catch (e) { return ""; } }

  function fetchLive() {
    var ds = districts();
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + ds.map(function (d) { return d.lat; }).join(",") +
      "&longitude=" + ds.map(function (d) { return d.lng; }).join(",") +
      "&current=precipitation&hourly=precipitation&forecast_days=2&timezone=Asia%2FManila";
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("Rain service returned " + r.status); return r.json(); }).then(function (data) {
      var arr = Array.isArray(data) ? data : [data], out = {};
      ds.forEach(function (d, i) {
        var row = arr[i], h = row.hourly, idx = h.time.findIndex(function (t) { return t.slice(0, 13) === row.current.time.slice(0, 13); });
        if (idx < 0) idx = 0;
        var mm = [row.current.precipitation || 0];
        for (var k = 1; k <= 3; k++) mm.push(h.precipitation[idx + k] || 0);
        out[d.id] = { mm: mm.map(function (v) { return Math.round(v * 10) / 10; }) };
      });
      return { at: Date.now(), source: "live", districts: out };
    });
  }

  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(KEY)); if (c && c.source === "live" && Date.now() - c.at < TTL) return c; } catch (e) { /* ignore */ }
    return null;
  }

  function announce() { try { window.dispatchEvent(new CustomEvent("fda:rain", { detail: snap })); } catch (e) { /* old browser */ } }

  FDA.rain = {
    PAGASA: { yellow: 7.5, orange: 15, red: 30 },
    names: { yellow: "Yellow", orange: "Orange", red: "Red" },
    mode: function () { return simLevel() ? "simulated" : snap ? snap.source : "sample"; },
    simulated: simLevel,
    setSim: function (level) {
      try { if (level) localStorage.setItem(SIM, level); else localStorage.removeItem(SIM); } catch (e) { /* ignore */ }
      snap = null; return FDA.rain.load(true);
    },

    /** The latest snapshot right now (never waits). Falls back to the sample evening until load() finishes. */
    get: function () {
      var s = simLevel();
      if (s) return scenario(SCALE[s] || 1, "simulated");
      return snap || readCache() || scenario(1, "sample");
    },

    load: function (force) {
      var s = simLevel();
      if (s) { snap = scenario(SCALE[s] || 1, "simulated"); announce(); return Promise.resolve(snap); }
      if (!force) { var c = readCache(); if (c) { snap = c; announce(); return Promise.resolve(snap); } }
      if (loading && !force) return loading;
      loading = fetchLive().then(function (live) {
        snap = live; try { localStorage.setItem(KEY, JSON.stringify(live)); } catch (e) { /* ignore */ }
      }).catch(function () {
        snap = snap && snap.source === "live" ? snap : scenario(1, "sample");
      }).then(function () { loading = null; announce(); return snap; });
      return loading;
    },

    mm: function (district, hours) {
      var d = FDA.rain.get().districts[district];
      return d ? d.mm[Math.max(0, Math.min(3, hours || 0))] : 0;
    },
    level: function (district, hours) { return FDA.agent.rainLevel(FDA.rain.mm(district, hours)); },
    /** Rain for a barangay name (uses its district). */
    mmFor: function (barangay, hours) { return FDA.rain.mm(FDA.geo.districtOf(CITY, barangay), hours); },
    levelFor: function (barangay, hours) { return FDA.agent.rainLevel(FDA.rain.mmFor(barangay, hours)); },
    /** Highest level seen anywhere in the city right now: "red" | "orange" | "yellow" | null. */
    worst: function (hours) {
      var rank = { yellow: 1, orange: 2, red: 3 }, best = null;
      districts().forEach(function (d) { var l = FDA.rain.level(d.id, hours); if (l && (!best || rank[l] > rank[best])) best = l; });
      return best;
    }
  };

  // Refresh every 15 minutes while any page is open
  setInterval(function () { FDA.rain.load(true); }, TTL);
})();
