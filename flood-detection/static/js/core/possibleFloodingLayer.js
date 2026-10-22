/**
 * "Possible flooding" layer for the flood map (draws what core/possibleFlooding.js works out)
 *
 * Colours the barangays by possible-flooding level, with a popup (hazard, forecast rain, level, why),
 * a legend, and a list of the barangays at the highest level right now (hidden below moderate).
 * It is separate from the static hazard layer (core/hazardLayer.js), so each can be shown or hidden on its own.
 * If the forecast or the hazard data cannot be loaded, the layer stays off and says why; the map keeps working.
 *
 *   FDA.possibleFloodingLayer.init(map, { legend, list, sub, pick })   elements to fill; pick(name) runs when a list row is clicked
 *   FDA.possibleFloodingLayer.setEnabled(on)                           the layer toggle
 *   FDA.possibleFloodingLayer.openPopup(name)                          opens a barangay's popup if the layer is on the map
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var esc = function (s) { return FDA.ui.esc(s); };

  var COLORS = { low: "#2f9e5b", moderate: "#e0b400", high: "#e8741a", severe: "#c0281c", unknown: "#8a96a1" };
  var HAZARD_TEXT = { high: "High", moderate: "Moderate", low: "Low", "below-threshold": "Under 20% in any class", unknown: "Unknown" };
  var NOTE = "Based on rain forecast and a 2016 flood hazard map. Not an official warning. Follow PAGASA and local authorities.";

  var map = null, els = {}, group = null, byName = {}, enabled = true;

  function PF() { return FDA.possibleFlooding; }
  function row(name) { var r = PF().get(); return r && r.byName[name]; }
  function levelOf(name) { var x = row(name); return x ? x.level : "unknown"; }

  function style(f) {
    var level = levelOf(f.properties.name), unknown = level === "unknown";
    return { color: unknown ? "#5f6b76" : "#ffffff", weight: unknown ? 1.5 : 1, opacity: 0.9, dashArray: unknown || f.properties.approx ? "4 4" : null,
      fillColor: COLORS[level], fillOpacity: 0.5 };
  }

  function hourText(iso) {
    var d = new Date(iso), today = new Date().toDateString() === d.toDateString();
    return (today ? "" : d.toLocaleDateString("en-PH", { weekday: "short" }) + " ") + d.toLocaleTimeString("en-PH", { hour: "numeric" });
  }
  function levelBadge(level) {
    return '<span class="badge ' + (level === "unknown" ? "badge--lvl-none" : "badge--wx-" + level) + '">' + FDA.ui.svg("possible-flood") + esc(PF().LABEL[level]) + "</span>";
  }

  function popup(name) {
    var x = row(name), r = PF().get();
    if (!x || !r) return "<strong>" + esc(name) + "</strong>";
    var rain = r.rain;
    return '<div class="qc-pop"><strong>' + esc(name) + '</strong><span class="qc-pop__meta">District ' + esc(x.district) + "</span>" +
      '<dl class="pf-pop__rows">' +
      "<div><dt>Flood hazard (2016 map)</dt><dd>" + esc(HAZARD_TEXT[x.hazard] || "Unknown") + "</dd></div>" +
      "<div><dt>Forecast rain, next 24 h</dt><dd>Up to " + rain.peakMm + " mm/h" + (rain.peakMm > 0 ? " around " + hourText(rain.peakAt) : "") + "<br><small>" + rain.nowMm + " mm/h now · " + rain.nextMm + " mm in total</small></dd></div>" +
      "<div><dt>Possible flooding</dt><dd>" + levelBadge(x.level) + "</dd></div></dl>" +
      '<span class="pf-pop__why">' + esc(x.reason) + "</span>" +
      '<small class="qc-pop__source">' + esc(NOTE) + (r.stale ? " The forecast is an offline copy from " + FDA.ui.clock(r.at) + "." : "") + "</small></div>";
  }

  function build() {
    var data = window.FDA_QC_HAZARD, L = window.L;
    if (group || !data || !map) return;
    if (!map.getPane("qcPossible")) map.createPane("qcPossible").style.zIndex = 420;
    group = L.geoJSON(data, {
      pane: "qcPossible", renderer: L.canvas({ pane: "qcPossible" }), style: style,
      onEachFeature: function (f, layer) {
        var name = f.properties.name; byName[name] = layer;
        layer.bindTooltip(function () { return esc(name) + " · " + esc(PF().LABEL[levelOf(name)]); }, { sticky: true, direction: "top" });
        layer.bindPopup(function () { return popup(name); }, { maxWidth: 290, autoPanPadding: [16, 16] });
        layer.on({
          mouseover: function () { layer.setStyle({ weight: 2.5, color: "#173248" }); },
          mouseout: function () { layer.setStyle(style(f)); }
        });
      }
    });
  }

  /* ---------- Legend, list and status text ---------- */
  function drawLegend() {
    if (!els.legend) return;
    var s = PF().state(), r = PF().get(), body;
    if (s === "error") body = '<p class="qc-legend__error" role="alert">' + esc(PF().error()) + "</p>";
    else if (s === "loading" || !r) body = '<p class="qc-legend__note" role="status">Loading the rain forecast and hazard data…</p>';
    else {
      body = "<ul>" + ["severe", "high", "moderate", "low", "unknown"].map(function (k) {
        return '<li><i style="background:' + COLORS[k] + (k === "unknown" ? ";border:1px dashed #5f6b76" : "") + '"></i>' + (k === "unknown" ? "Unknown (no hazard data)" : PF().LABEL[k]) + "</li>";
      }).join("") + "</ul>" +
        '<p class="qc-legend__note">Forecast peak ' + r.rain.peakMm + " mm/h in the next 24 h · " + (r.stale ? "offline copy from " : "updated ") + FDA.ui.clock(r.at) + ".<br>" + esc(NOTE) + "</p>";
    }
    var open = els.legend.querySelector("details") ? els.legend.querySelector("details").open : !(window.matchMedia && window.matchMedia("(max-width: 899px)").matches);
    els.legend.innerHTML = "<details" + (open ? " open" : "") + "><summary>Possible flooding</summary>" + body + "</details>";
    els.legend.hidden = !enabled;
  }

  function drawList() {
    if (!els.list) return;
    var r = PF().get();
    if (PF().state() !== "ready" || !r || !r.top.length) { els.list.hidden = true; els.list.innerHTML = ""; return; }
    els.list.hidden = false;
    els.list.className = "pf-list pf-list--" + r.highest;
    els.list.innerHTML = "<strong>" + FDA.ui.svg("possible-flood", "md") + "Possible flooding · " + esc(PF().LABEL[r.highest]) + "</strong>" +
      "<small>" + r.count + " barangay" + (r.count === 1 ? "" : "s") + " at this level" + (r.count > r.top.length ? ", top " + r.top.length + " shown" : "") + "</small>" +
      '<ul class="pf-list__rows">' + r.top.map(function (x) {
        return '<li><button type="button" data-name="' + esc(x.name) + '"><span>' + esc(x.name) + "</span><small>D" + esc(x.district) + " · " + esc(HAZARD_TEXT[x.hazard].toLowerCase()) + " hazard</small></button></li>";
      }).join("") + "</ul><small>" + esc(NOTE) + "</small>";
  }

  function drawStatus() {
    if (!els.sub) return;
    var s = PF().state();
    els.sub.textContent = s === "error" ? "Could not be worked out" : s === "loading" ? "Loading…" : "Rain forecast × 2016 hazard map";
  }

  function sync() {
    var ready = PF().state() === "ready";
    if (ready) build();
    if (group && map) {
      if (ready && enabled) { group.eachLayer(function (l) { l.setStyle(style(l.feature)); }); if (!map.hasLayer(group)) group.addTo(map); }
      else if (map.hasLayer(group)) map.removeLayer(group);
    }
    drawLegend(); drawList(); drawStatus();
  }

  FDA.possibleFloodingLayer = {
    COLORS: COLORS,
    init: function (m, elements) {
      map = m; els = elements || {};
      if (els.list) els.list.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-name]"); if (b && els.pick) els.pick(b.getAttribute("data-name"));
      });
      window.addEventListener("fda:possibleflooding", sync);
      sync();
      return PF().load();
    },
    setEnabled: function (on) {
      enabled = on;
      if (els.legend) els.legend.hidden = !on;
      sync();
    },
    openPopup: function (name) {
      var l = byName[name];
      if (l && map && group && map.hasLayer(group)) l.openPopup(l.getBounds().getCenter());
    }
  };
})();
