/**
 * Map toolkit: loads Leaflet on demand and builds the maps used on the map, areas, report and routes pages.
 * Base map: OpenStreetMap tiles (fine for a class demo; for a public site use a tile provider with a free tier).
 *
 *   FDA.mapkit.ready()               -> Promise<L>  loads Leaflet from a CDN the first time
 *   FDA.mapkit.create(el, options)   -> Promise<L.Map>
 *   FDA.mapkit.HAZARD / RISK         colours (never the only signal: cards always carry the words too)
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
  var JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
  var loading = null;

  var HAZARD = { high: "#d64532", medium: "#ef9a3c", low: "#f2cf5b", none: "#e8eef3" };
  var RISK = { high: "#d64532", elevated: "#ef9a3c", low: "#dfe9f1" };
  var STATUS = { "flood-warning": "#b8291f", "possible-flood": "#c2570c", "unclear-photo": "#5f7385", "no-flood": "#1d6b3a" };
  var QC = [[14.575, 120.97], [14.775, 121.135]];

  function ready() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (loading) return loading;
    loading = new Promise(function (ok, fail) {
      var link = document.createElement("link"); link.rel = "stylesheet"; link.href = CSS; document.head.appendChild(link);
      var s = document.createElement("script"); s.src = JS;
      s.onload = function () { ok(window.L); };
      s.onerror = function () { loading = null; fail(new Error("The map library could not be loaded. Check your internet connection.")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  FDA.mapkit = {
    HAZARD: HAZARD, RISK: RISK, STATUS: STATUS, QC_BOUNDS: QC, ready: ready,
    /** Create a map with the OSM base layer, zoomed to Quezon City. options: {zoom, center, minimal} */
    create: function (el, options) {
      options = options || {};
      return ready().then(function (L) {
        var map = L.map(el, { preferCanvas: true, zoomControl: !options.minimal, attributionControl: true, minZoom: 11, maxZoom: 19, zoomSnap: 0.5, maxBounds: [[14.45, 120.85], [14.9, 121.25]] });
        // OSM requires a visible credit, so it stays, but kept to one short line so it never covers the map.
        // The "Leaflet" prefix is optional and removed; "sample data" is already shown by the SAMPLE DATA badge.
        map.attributionControl.setPrefix(false);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19, attribution: "© <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a>"
        }).addTo(map);
        if (options.center) map.setView(options.center, options.zoom || 14); else map.fitBounds(QC);
        return map;
      });
    },
    statusIcon: function (L, status, label) {
      return L.divIcon({ className: "fda-pin fda-pin--" + status, html: "<span>" + (label || "") + "</span>", iconSize: [26, 26], iconAnchor: [13, 13] });
    },
    dropIcon: function (L, n) {
      return L.divIcon({ className: "fda-spot", html: '<span class="fda-spot__drop"><span>' + n + "</span></span>", iconSize: [28, 34], iconAnchor: [14, 32] });
    }
  };
})();
