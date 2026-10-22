/**
 * Quezon City flood hazard layer (per barangay) for the flood map
 *
 * Data: static/data/qc-flood-hazard.js, a script copy of qc-flood-hazard.geojson (a page opened from disk
 * cannot read a .geojson file, but it can load a script). Rebuild both with scripts/build_qc_flood_hazard.js.
 * Each feature has: name, district, risk, source, low / moderate / high (% of the covered area), coverage (%).
 *
 * risk: "low" | "moderate" | "high"  highest LiPAD class covering at least the threshold of the barangay
 *       "below-threshold"            covered by the data, but no class reaches the threshold
 *       "unknown"                    too little of the barangay is covered by the data (never shown as safe)
 *
 *   FDA.hazardLayer.create(map)       -> Promise<L.GeoJSON>  (rejects with a readable message if the data cannot be loaded)
 *   FDA.hazardLayer.renderLegend(el, error)   fills the legend box (collapsed on phones)
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var esc = function (s) { return FDA.ui.esc(s); };
  var DATA = document.currentScript.src.replace(/js\/core\/hazardLayer\.js(\?.*)?$/, "data/qc-flood-hazard.js");

  var COLORS = { low: "#2f9e5b", moderate: "#e0b400", high: "#d64532", "below-threshold": "#c9d6e0", unknown: "#8a96a1" };
  var LABEL = { low: "Low", moderate: "Moderate", high: "High", "below-threshold": "Under threshold", unknown: "Unknown" };
  var share = 20;   // % of the covered area a class needs to name the barangay (read from the data file)
  var loading = null;

  function load() {
    if (window.FDA_QC_HAZARD) return Promise.resolve(window.FDA_QC_HAZARD);
    if (loading) return loading;
    loading = new Promise(function (ok, fail) {
      var s = document.createElement("script"); s.src = DATA;
      s.onload = function () {
        if (window.FDA_QC_HAZARD && window.FDA_QC_HAZARD.features) ok(window.FDA_QC_HAZARD);
        else { loading = null; fail(new Error("The flood hazard data file is empty or damaged.")); }
      };
      s.onerror = function () { loading = null; fail(new Error("The flood hazard data could not be loaded (static/data/qc-flood-hazard.js).")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function style(f) {
    var r = f.properties.risk, unknown = r === "unknown";
    return { color: unknown ? "#5f6b76" : "#ffffff", weight: unknown ? 1.5 : 1, opacity: 0.9, dashArray: unknown || f.properties.approx ? "4 4" : null,
      fillColor: COLORS[r] || COLORS.unknown, fillOpacity: r === "below-threshold" ? 0.35 : 0.45 };
  }

  function riskText(p) {
    if (p.risk === "below-threshold") return "No class reaches " + share + "% of the area";
    if (p.risk === "unknown") return "Unknown (not enough data)";
    return LABEL[p.risk] + " flood hazard";
  }

  function popup(p) {
    return '<div class="qc-pop"><strong>' + esc(p.name) + "</strong>" +
      '<span class="qc-pop__meta">District ' + esc(p.district) + "</span>" +
      '<span class="qc-pop__risk"><i style="background:' + (COLORS[p.risk] || COLORS.unknown) + '"></i>' + esc(riskText(p)) + "</span>" +
      '<dl class="qc-pop__pct"><div><dt>Low</dt><dd>' + p.low + '%</dd></div><div><dt>Moderate</dt><dd>' + p.moderate + '%</dd></div><div><dt>High</dt><dd>' + p.high + "%</dd></div></dl>" +
      '<span class="qc-pop__meta">Share of the mapped area · ' + p.coverage + "% of the barangay is covered by the map</span>" +
      (p.note && p.risk !== "below-threshold" ? '<span class="qc-pop__meta">' + esc(p.note) + "</span>" : "") +
      (p.approx ? '<span class="qc-pop__meta">Approximate boundary: this barangay has no official outline in the boundary data, so its percentages are rough.</span>' : "") +
      '<small class="qc-pop__source">Source: ' + esc(p.source) + ". 100-year scenario, not a forecast of flooding now.</small></div>";
  }

  FDA.hazardLayer = {
    COLORS: COLORS, LABEL: LABEL, load: load,

    create: function (map) {
      return load().then(function (data) {
        var L = window.L;
        if (data.riskShare) share = Math.round(data.riskShare * 100);
        // Own pane above the barangay outlines, with its own canvas, so it can be switched on and off on its own
        if (!map.getPane("qcHazard")) { map.createPane("qcHazard").style.zIndex = 410; }
        return L.geoJSON(data, {
          pane: "qcHazard", renderer: L.canvas({ pane: "qcHazard" }), style: style,
          onEachFeature: function (f, layer) {
            var p = f.properties;
            layer.bindTooltip(esc(p.name) + " · " + esc(LABEL[p.risk] || "Unknown"), { sticky: true, direction: "top" });
            layer.bindPopup(popup(p), { maxWidth: 280, autoPanPadding: [16, 16] });
            layer.on({
              mouseover: function () { layer.setStyle({ weight: 2.5, color: "#173248" }); },
              mouseout: function () { layer.setStyle(style(f)); }
            });
          }
        });
      });
    },

    renderLegend: function (el, error) {
      if (!el) return;
      var rows = ["high", "moderate", "low", "below-threshold", "unknown"].map(function (k) {
        var text = { high: "High", moderate: "Moderate", low: "Low", "below-threshold": "Under " + share + "% in any class", unknown: "Unknown (not enough data)" }[k];
        return '<li><i style="background:' + COLORS[k] + (k === "unknown" ? ";border:1px dashed #5f6b76" : "") + '"></i>' + text + "</li>";
      }).join("");
      var open = window.matchMedia && window.matchMedia("(max-width: 899px)").matches ? "" : " open";
      el.innerHTML = '<details' + open + '><summary>Flood hazard (100-year)</summary>' +
        (error ? '<p class="qc-legend__error" role="alert">' + esc(error) + "</p>" : "<ul>" + rows + "</ul>" +
          '<p class="qc-legend__note">Highest class covering at least ' + share + '% of the barangay. UP DREAM / Phil-LiDAR 1, 2016.</p>') + "</details>";
    }
  };
})();
