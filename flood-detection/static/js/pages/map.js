/**
 * Flood map (home page)
 *
 * Leaflet + OpenStreetMap with the 142 Quezon City barangays.
 *   hover a barangay  -> card with hazard, rain, area risk, recurring spots, latest report (and the matching row lights up)
 *   click a barangay  -> zoom in and load its streets from OpenStreetMap, coloured by how much lies in a hazard zone
 *   hover a street    -> street card;  Rain slider (Now, +1 h, +2 h, +3 h) re-runs Rule 2 for that hour
 * Layers: hazard zones, rain (area-risk outlines + district rain labels), streets, recurring flood spots,
 * and community reports (clustered when zoomed out).
 * Hazard levels are SAMPLE data until the UP NOAH layer is added (see scripts/build_barangays.py).
 */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var CITY = "Quezon City";
  var HAZ = FDA.mapkit.HAZARD, RISK = FDA.mapkit.RISK;
  var LVL = { yellow: "Yellow", orange: "Orange", red: "Red" };
  var RISK_RANK = { high: 3, elevated: 2, low: 1 }, HAZ_RANK = { high: 3, medium: 2, low: 1, none: 0 };

  var state = {
    hours: 0, layers: { hazard: false, qchazard: false, possible: true, rain: true, streets: true, spots: true, reports: true },
    selected: null, hover: null, hoverStreet: null, pinStreet: null, areas: null,
    statuses: { "flood-warning": true, "possible-flood": true, "unclear-photo": false, "no-flood": false }, windowH: 24, outdated: true
  };
  var L = null, map = null, polys = {}, polyGroup = null, streetGroup = null, streetData = null, streetFor = null;
  var spotGroup = null, reportGroup = null, rainGroup = null, qcGroup = null, tempMarker = null;

  var card = $("#map-card"), listUl = $("#risk-list"), banner = $("#rain-banner"), legend = $("#map-legend"), toastEl = $("#map-toast");

  /* ---------- Small helpers ---------- */
  function say(msg, ms) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(say.t); say.t = setTimeout(function () { toastEl.hidden = true; }, ms || 4000);
  }
  function areaOf(name) { return state.areas.byName[name]; }
  function hourText(h) { return h ? "+" + h + " h" : "now"; }
  function lvlBadge(level, mm) {
    return '<span class="badge badge--lvl-' + (level || "none") + '">' + FDA.ui.svg("possible-flood") + (level ? LVL[level] + " rain" : "No rain level") + " · " + mm + " mm/h</span>";
  }
  function hzBadge(h) { return '<span class="badge badge--hz-' + h + '"><svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M3 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/></svg>' + FDA.hazard.label(h) + "</span>"; }
  function reportsIn(name) {
    return FDA.store.db().reports.filter(function (r) { return !r.removed && !r.dupOf && r.barangay === name; }).sort(function (a, b) { return b.ts - a.ts; });
  }
  function recompute() { state.areas = FDA.areas.compute(state.hours); }

  /* ---------- Polygon styling ---------- */
  function polyStyle(name) {
    var b = FDA.hazard.get(name), a = areaOf(name), L_ = state.layers;
    var fill = L_.hazard ? HAZ[b.hazard] : L_.rain ? RISK[a.level] : null;
    var weight = 1, color = "#ffffff", fo = fill ? 0.55 : 0, dash = null;
    if (L_.rain && a.level === "high") { weight = 3; color = "#8f1d14"; }
    else if (L_.rain && a.level === "elevated") { weight = 2.5; color = "#b45309"; }
    else if (!fill) { color = "#8597a8"; }
    if (b.approx) dash = "4 4";
    if (name === state.selected) { weight = 3.5; color = "#0b5d98"; fo = fill ? 0.7 : 0.05; }
    if (name === state.hover) { weight = 3.5; color = "#173248"; fo = fill ? 0.8 : 0.1; }
    return { color: color, weight: weight, fillColor: fill || "#ffffff", fillOpacity: fo, opacity: 1, dashArray: dash };
  }
  function restyle(name) { if (polys[name]) polys[name].setStyle(polyStyle(name)); }
  function restyleAll() { Object.keys(polys).forEach(restyle); keepStreetsOnTop(); }
  function keepStreetsOnTop() { if (streetGroup) streetGroup.bringToFront(); }

  /* ---------- Cards ---------- */
  function barangayCard(name, pinned) {
    var b = FDA.hazard.get(name), a = areaOf(name), spots = FDA.hazard.spotsIn(name), reps = reportsIn(name), latest = reps[0];
    var corners = spots.slice(0, 2).map(function (s) { return esc(s.corner); }).join(", ") + (spots.length > 2 ? "…" : "");
    var latestHtml = latest && Date.now() - latest.ts < 2 * 3600000
      ? "#" + latest.id + " " + esc(FDA.agent.label(latest.status)) + " · " + FDA.ui.timeAgo(latest.ts) : "None in the last 2 h";
    return (pinned ? '<button class="map-card__close" type="button" data-close aria-label="Close card">×</button>' : "") +
      '<p class="map-card__eyebrow">Barangay · District ' + b.district + (b.approx ? " · approximate area" : "") + "</p>" +
      '<h2 class="map-card__title">' + esc(name) + "</h2>" +
      '<div class="map-card__badges">' + hzBadge(b.hazard) + lvlBadge(a.rain, a.mm) + "</div>" +
      "<dl><dt>Area risk (" + hourText(state.hours) + ')</dt><dd class="text-risk-' + a.level + '">' + esc(a.text) + "</dd>" +
      "<dt>Recurring spots</dt><dd>" + (spots.length ? spots.length + " · " + corners : "None logged") + "</dd>" +
      "<dt>Reports</dt><dd>" + latestHtml + "</dd></dl>" +
      '<div class="map-card__actions"><a class="btn btn--primary" href="areas.html?b=' + encodeURIComponent(name) + '">Open barangay</a>' +
      '<a class="btn btn--outline" href="report.html?barangay=' + encodeURIComponent(name) + '">Report here</a></div>';
  }

  function streetCard(s, brgy, pinned) {
    var spots = FDA.hazard.spotsOnStreet(brgy, s.name), worst = FDA.hazard.worstDepth(spots);
    var rep = reportsIn(brgy).filter(function (r) { return r.street && (r.street.toLowerCase().indexOf(s.name.toLowerCase()) >= 0 || s.name.toLowerCase().indexOf(r.street.toLowerCase()) >= 0); })[0];
    var d = FDA.hazard.get(brgy).district, lvl1 = FDA.rain.level(d, 1), mm1 = FDA.rain.mm(d, 1);
    return (pinned ? '<button class="map-card__close" type="button" data-close aria-label="Close card">×</button>' : "") +
      '<p class="map-card__eyebrow">Street · ' + esc(brgy) + "</p>" +
      '<h2 class="map-card__title">' + esc(s.name) + "</h2>" +
      "<dl><dt>In medium or high hazard zone</dt><dd>" + s.pct + "%</dd></dl>" +
      '<div class="map-card__bar" role="img" aria-label="' + s.pct + ' percent of this street lies in a medium or high hazard zone"><span style="width:' + s.pct + '%;background:' + FDA.streets.COLORS[FDA.streets.bin(s.pct)] + '"></span></div>' +
      "<dl><dt>Recurring spots</dt><dd>" + (spots.length ? spots.length + " · " + esc(spots[0].corner.replace(/^.* cor\.? /i, "cor. ")) : "None logged") + "</dd>" +
      "<dt>Worst depth</dt><dd>" + (worst ? esc(FDA.hazard.depth(worst.depth).label) : "–") + "</dd>" +
      "<dt>Latest report</dt><dd>" + (rep ? "#" + rep.id + " " + esc(FDA.agent.label(rep.status)) + " · " + FDA.ui.timeAgo(rep.ts) : "None yet") + "</dd>" +
      "<dt>Rain at +1 h</dt><dd>" + (lvl1 ? LVL[lvl1] : "None") + " · " + mm1 + " mm/h</dd></dl>" +
      '<div class="map-card__actions"><a class="btn btn--primary" href="report.html?barangay=' + encodeURIComponent(brgy) + "&street=" + encodeURIComponent(s.name) + '">Report on this street</a></div>';
  }

  function renderCard() {
    var s = state.hoverStreet || state.pinStreet, html = "";
    if (s && streetFor) html = streetCard(s, streetFor, !state.hoverStreet);
    else if (state.hover) html = barangayCard(state.hover, false);
    else if (state.selected) html = barangayCard(state.selected, true);
    card.hidden = !html; card.innerHTML = html;
  }
  card.addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) { state.selected = state.pinStreet = null; restyleAll(); drawList(); renderCard(); setHash(); }
  });

  /* ---------- Sidebar: rain banner and area-risk list ---------- */
  function drawBanner() {
    var snap = FDA.rain.get(), best = null;
    FDA.geo.districts(CITY).forEach(function (d) {
      var mm = FDA.rain.mm(d.id, state.hours);
      if (!best || mm > best.mm) best = { id: d.id, mm: mm, level: FDA.agent.rainLevel(mm) };
    });
    var next3 = best ? [1, 2, 3].reduce(function (s, h) { return s + FDA.rain.mm(best.id, h); }, 0) : 0;
    var modeText = { live: "Live · Open-Meteo, updated " + FDA.ui.clock(snap.at), simulated: "Demo storm (simulated) so Rule 2 can be shown on a dry day", sample: "Sample rain: live data could not be loaded" }[snap.source];
    banner.className = "rain-banner" + (best && best.level ? " rain-banner--" + best.level : "");
    banner.innerHTML = best && best.level
      ? "<strong>" + FDA.ui.svg("possible-flood", "md") + LVL[best.level] + " rainfall · District " + best.id + " " + (state.hours ? "(" + hourText(state.hours) + ")" : "") + "</strong><small>" + best.mm + " mm/h " + hourText(state.hours) + " · " + Math.round(next3 * 10) / 10 + " mm expected in the next 3 h · PAGASA level (estimate)</small><small>" + esc(modeText) + "</small>"
      : "<strong>" + FDA.ui.svg("no-flood", "md") + "No rainfall warning level " + hourText(state.hours) + "</strong><small>Heaviest rain: " + (best ? best.mm + " mm/h in District " + best.id : "–") + ". Below the PAGASA yellow level (7.5 mm/h).</small><small>" + esc(modeText) + "</small>";
    $("#rain-updated").textContent = { live: "Updated " + FDA.ui.clock(snap.at) + " · Open-Meteo", simulated: "Demo storm", sample: "Sample rain" }[snap.source];
    $("#l-rain-sub").textContent = { live: "Open-Meteo · every 15 min", simulated: "Demo storm (simulated)", sample: "Sample rain (live unavailable)" }[snap.source];
  }

  function rowsForList() {
    var all = Object.keys(state.areas.byName).map(function (n) { return state.areas.byName[n]; });
    all.sort(function (x, y) { return RISK_RANK[y.level] - RISK_RANK[x.level] || HAZ_RANK[y.hazard] - HAZ_RANK[x.hazard] || y.spots - x.spots || x.name.localeCompare(y.name); });
    var top = all.slice(0, 6);
    if (state.selected && !top.some(function (r) { return r.name === state.selected; })) top.unshift(state.areas.byName[state.selected]);
    return top;
  }
  function drawList() {
    var rows = rowsForList(), c = state.areas.counts;
    $("#all-areas").textContent = "All 142 →";
    listUl.innerHTML = rows.map(function (r) {
      return '<li><button class="risk-item' + (r.name === state.selected ? " is-selected" : "") + '" type="button" data-name="' + esc(r.name) + '"><span class="risk-bar risk-bar--' + r.level + '"></span><span><span class="risk-item__name">' + esc(r.name) + "</span>" +
        '<span class="risk-item__meta">D' + r.district + " · " + esc(FDA.hazard.label(r.hazard).toLowerCase()) + " · " + (r.rain ? LVL[r.rain].toLowerCase() + " rain" : "no rain level") + " · " + r.spots + " spot" + (r.spots === 1 ? "" : "s") +
        '</span><span class="risk-item__meta"><strong class="text-risk-' + r.level + '">' + esc(FDA.agent.areaLabel(r.level)) + " risk</strong></span></span></button></li>";
    }).join("") + '<li class="risk-empty">' + c.high + " high · " + c.elevated + " elevated · " + c.low + " low (" + hourText(state.hours) + ")</li>";
  }
  listUl.addEventListener("click", function (e) { var b = e.target.closest("[data-name]"); if (b) select(b.dataset.name, true); });
  listUl.addEventListener("mouseover", function (e) { var b = e.target.closest("[data-name]"); if (b && b.dataset.name !== state.hover) setHover(b.dataset.name, true); });
  listUl.addEventListener("mouseleave", function () { setHover(null, true); });
  function markRows() {
    $$(".risk-item", listUl).forEach(function (el) { el.classList.toggle("is-hover", el.dataset.name === state.hover); });
  }

  /* ---------- Hover and select ---------- */
  function setHover(name, fromList) {
    var prev = state.hover; state.hover = name;
    if (prev && prev !== name) restyle(prev);
    if (name) { restyle(name); if (polys[name] && polys[name].bringToFront) { polys[name].bringToFront(); keepStreetsOnTop(); } }
    markRows(); renderCard();
  }

  function select(name, fit) {
    if (!FDA.hazard.get(name)) return;
    var prev = state.selected; state.selected = name; state.pinStreet = null; state.hoverStreet = null;
    if (prev) restyle(prev); restyle(name);
    if (map && polys[name] && fit !== false) map.fitBounds(polys[name].getBounds(), { padding: [40, 40], maxZoom: 16 });
    loadStreets(name); drawList(); renderCard(); setHash(); closeSidebar();
  }

  function setHash() {
    try { history.replaceState(null, "", state.selected ? "#b=" + encodeURIComponent(state.selected) : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }

  /* ---------- Streets ---------- */
  function loadStreets(name) {
    if (streetGroup && map) { map.removeLayer(streetGroup); streetGroup = null; }
    streetData = null; streetFor = null; drawLegend();
    if (!map) return;
    say("Loading streets of " + name + "…", 20000);
    FDA.streets.load(name).then(function (res) {
      if (state.selected !== name) return;
      toastEl.hidden = true;
      streetData = res; streetFor = name; drawStreets(); drawLegend(); fillPlaces();
      if (!res.streets.length) say("OpenStreetMap has no named streets for " + name + " yet.");
    }).catch(function (err) { if (state.selected === name) say(err.message, 7000); });
  }

  function drawStreets() {
    if (streetGroup) { map.removeLayer(streetGroup); streetGroup = null; }
    if (!streetData) return;
    streetGroup = L.featureGroup();
    streetData.streets.forEach(function (s) {
      var color = FDA.streets.COLORS[FDA.streets.bin(s.pct)], layers = [];
      s.lines.forEach(function (line) {
        var pl = L.polyline(line, { color: color, weight: 3.5, opacity: 0.95, lineCap: "round" });
        pl.bindTooltip(s.name, { sticky: true, className: "street-tip" });
        pl.on("mouseover", function () { state.hoverStreet = s; styleStreet(s, true); renderCard(); });
        pl.on("mouseout", function () { state.hoverStreet = null; styleStreet(s, false); renderCard(); });
        pl.on("click", function (e) { L.DomEvent.stopPropagation(e); state.pinStreet = s; renderCard(); });
        layers.push(pl); streetGroup.addLayer(pl);
      });
      s._layers = layers; s._color = color;
    });
    if (state.layers.streets) streetGroup.addTo(map);
  }
  function styleStreet(s, on) { (s._layers || []).forEach(function (pl) { pl.setStyle(on ? { weight: 7, color: "#0b5d98" } : { weight: 3.5, color: s._color }); if (on) pl.bringToFront(); }); }

  /* ---------- Markers: spots, reports, rain labels ---------- */
  function drawSpots() {
    if (spotGroup) map.removeLayer(spotGroup);
    spotGroup = L.layerGroup();
    FDA.hazard.spots().forEach(function (s) {
      var m = L.marker([s.lat, s.lng], { icon: FDA.mapkit.dropIcon(L, s.times), title: s.corner, keyboard: true });
      m.bindPopup("<strong>" + esc(s.corner) + "</strong><br>" + esc(s.barangay) + "<br>Flooded " + s.times + " times · worst: " + esc(FDA.hazard.depth(s.depth).label) +
        "<br>" + esc(FDA.hazard.pass(s.pass)) + "<br>Last seen " + esc(s.last) + "<br><small>" + esc(s.source || "") + "</small>");
      spotGroup.addLayer(m);
    });
    if (state.layers.spots) spotGroup.addTo(map);
  }

  function visibleReports() {
    var now = Date.now();
    return FDA.store.db().reports.filter(function (r) {
      if (r.removed || r.dupOf || r.lat == null || !state.statuses[r.status] || now - r.ts > state.windowH * 3600000) return false;
      return state.outdated || FDA.agent.isRecent(r, now);
    }).sort(function (a, b) { return b.ts - a.ts; });
  }
  var wantReport = +FDA.ui.param("id") || null, wantMarker = null;
  function drawReports() {
    if (reportGroup) map.removeLayer(reportGroup);
    reportGroup = L.layerGroup(); wantMarker = null;
    var rows = visibleReports(), zoom = map.getZoom(), cell = zoom < 13 ? 0.012 : 0, buckets = {};
    $("#l-reports-sub").textContent = rows.length + " shown · newest first";
    rows.forEach(function (r) {
      var key = cell ? Math.round(r.lat / cell) + ":" + Math.round(r.lng / cell) : "r" + r.id;
      (buckets[key] = buckets[key] || []).push(r);
    });
    Object.keys(buckets).forEach(function (k) {
      var g = buckets[k], first = g[0], m;
      if (g.length > 1) {
        var worst = g.some(function (r) { return r.status === "flood-warning"; }) ? "flood-warning" : g[0].status;
        m = L.marker([first.lat, first.lng], { icon: L.divIcon({ className: "fda-pin fda-pin--" + worst + " fda-pin--cluster", html: "<span>" + g.length + "</span>", iconSize: [34, 34], iconAnchor: [17, 17] }) });
        m.on("click", function () { map.setView(m.getLatLng(), Math.max(map.getZoom() + 2, 14)); });
      } else {
        var fresh = FDA.agent.isRecent(first);
        m = L.marker([first.lat, first.lng], { icon: FDA.mapkit.statusIcon(L, first.status, ""), opacity: fresh ? 1 : 0.55, title: "#" + first.id + " " + FDA.agent.label(first.status) });
        m.bindPopup('<strong>#' + first.id + " " + esc(FDA.agent.label(first.status)) + "</strong><br>" + esc(first.street) + ", " + esc(first.barangay) + "<br>" + FDA.ui.timeAgo(first.ts) + (fresh ? "" : " · may be outdated") +
          '<br><a href="report-details.html?id=' + first.id + '">Open report</a>');
        if (first.id === wantReport) wantMarker = m;
      }
      reportGroup.addLayer(m);
    });
    if (state.layers.reports) reportGroup.addTo(map);
  }

  function drawRain() {
    if (rainGroup) map.removeLayer(rainGroup);
    rainGroup = L.layerGroup();
    FDA.geo.districts(CITY).forEach(function (d) {
      var mm = FDA.rain.mm(d.id, state.hours), lvl = FDA.agent.rainLevel(mm);
      rainGroup.addLayer(L.marker([d.lat, d.lng], { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<span class="fda-label' + (lvl ? " fda-label--" + lvl : "") + '">D' + d.id + " · " + mm + " mm/h</span>", iconSize: [92, 22], iconAnchor: [46, 11] }) }));
    });
    if (state.layers.rain) rainGroup.addTo(map);
  }

  /* ---------- Legend ---------- */
  function drawLegend() {
    var h = "";
    if (state.layers.hazard) h += "<h3>Flood hazard · SAMPLE</h3><ul>" + ["high", "medium", "low"].map(function (k) { return '<li><i style="background:' + HAZ[k] + '"></i>' + FDA.hazard.label(k) + "</li>"; }).join("") + "</ul>";
    else if (state.layers.rain) h += "<h3>Area risk</h3><ul>" + ["high", "elevated", "low"].map(function (k) { return '<li><i style="background:' + RISK[k] + '"></i>' + FDA.agent.areaLabel(k) + "</li>"; }).join("") + "</ul>";
    if (state.layers.rain) h += "<h3" + (h ? ' style="margin-top:8px"' : "") + ">Outline = area risk " + hourText(state.hours) + '</h3><ul><li><i style="background:#fff;border:3px solid #8f1d14"></i>High</li><li><i style="background:#fff;border:2.5px solid #b45309"></i>Elevated</li></ul>';
    if (streetData && state.layers.streets) h += '<h3 style="margin-top:8px">Street in hazard zone</h3><ul><li><i class="line" style="background:' + FDA.streets.COLORS.over50 + '"></i>Over 50%</li><li><i class="line" style="background:' + FDA.streets.COLORS.mid + '"></i>20–50%</li><li><i class="line" style="background:' + FDA.streets.COLORS.under20 + '"></i>Under 20%</li><li><i class="line" style="background:' + FDA.streets.COLORS.none + '"></i>Outside</li></ul>';
    legend.innerHTML = h; legend.hidden = !h;
  }

  /* ---------- Flood hazard layer (LiPAD 100-year, per barangay) ---------- */
  function drawQcHazard() {
    var box = $("#qc-legend"), sub = $("#l-qchazard-sub");
    box.hidden = !state.layers.qchazard;
    FDA.hazardLayer.create(map).then(function (layer) {
      qcGroup = layer; if (state.layers.qchazard) layer.addTo(map);
      FDA.hazardLayer.renderLegend(box);
    }).catch(function (err) {
      FDA.hazardLayer.renderLegend(box, err.message); sub.textContent = "Could not be loaded";
      say(err.message, 6000);
    });
  }

  /* ---------- Layers ---------- */
  function setLayer(key, on) {
    state.layers[key] = on;
    var sw = $('[data-layer="' + key + '"]'); if (sw) sw.setAttribute("aria-checked", String(on));
    if (!map) return;
    var g = { streets: streetGroup, spots: spotGroup, reports: reportGroup, rain: rainGroup, qchazard: qcGroup }[key];
    if (g) { if (on) g.addTo(map); else map.removeLayer(g); }
    if (key === "qchazard") $("#qc-legend").hidden = !on;
    if (key === "possible") FDA.possibleFloodingLayer.setEnabled(on);
    if (key === "streets" && on && streetGroup) keepStreetsOnTop();
    if (key === "hazard" || key === "rain") { restyleAll(); drawLegend(); }
  }
  $$("[data-layer]").forEach(function (sw) {
    sw.addEventListener("click", function () { setLayer(sw.dataset.layer, sw.getAttribute("aria-checked") !== "true"); });
  });

  /* Report filters */
  $$("#report-filters .chip").forEach(function (b) {
    b.addEventListener("click", function () { state.statuses[b.dataset.status] = !state.statuses[b.dataset.status]; b.setAttribute("aria-pressed", String(state.statuses[b.dataset.status])); if (map) drawReports(); });
  });
  $("#map-time").addEventListener("change", function () { state.windowH = +this.value; if (map) drawReports(); });
  $("#outdated-switch").addEventListener("click", function () { state.outdated = this.getAttribute("aria-checked") !== "true"; this.setAttribute("aria-checked", String(state.outdated)); if (map) drawReports(); });

  /* Rain slider */
  $$("#rain-slider button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.hours = +b.dataset.h;
      $$("#rain-slider button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      refreshAll();
    });
  });
  $("#rain-mode").value = FDA.rain.simulated();
  $("#rain-mode").addEventListener("change", function () { FDA.rain.setSim(this.value || null).then(refreshAll); });
  window.addEventListener("fda:rain", function () { refreshAll(); });

  /* Phone: the sidebar opens over the map */
  var side = $("#map-sidebar"), toggle = $("#sidebar-toggle");
  function closeSidebar() { side.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }
  toggle.addEventListener("click", function () { var open = side.classList.toggle("is-open"); toggle.setAttribute("aria-expanded", String(open)); });

  /* ---------- Search ---------- */
  function fillPlaces() {
    var names = FDA.geo.barangays(CITY).concat(FDA.geo.landmarks().map(function (l) { return l.name; }));
    if (streetData) names = streetData.streets.map(function (s) { return s.name; }).concat(names);
    $("#map-places").innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
  }
  function focusStreet(s) {
    state.pinStreet = s; renderCard();
    var pts = []; s.lines.forEach(function (l) { pts = pts.concat(l); });
    map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 18 });
    styleStreet(s, true); setTimeout(function () { styleStreet(s, false); }, 2500);
  }
  function search(text) {
    text = String(text || "").trim(); if (!text || !map) return;
    var k = text.toLowerCase();
    if (streetData) {
      var hit = streetData.streets.filter(function (s) { return s.name.toLowerCase() === k; })[0] || streetData.streets.filter(function (s) { return s.name.toLowerCase().indexOf(k) === 0; })[0];
      if (hit) return focusStreet(hit);
    }
    var r = FDA.geo.resolve(text);
    if (r && r.barangay && FDA.hazard.get(r.barangay)) {
      var landmark = FDA.geo.landmarks().filter(function (l) { return l.name === r.name; })[0];
      select(r.barangay, !landmark);
      if (landmark) { map.setView([r.lat, r.lng], 16); if (tempMarker) map.removeLayer(tempMarker); tempMarker = L.marker([r.lat, r.lng], { title: r.name }).addTo(map).bindPopup(esc(r.name)).openPopup(); }
      return;
    }
    say("We could not find “" + text + "”. Try a barangay name, or open a barangay first to search its streets.", 5000);
  }
  $("#map-search").addEventListener("change", function () { search(this.value); });
  $("#map-search").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(this.value); } });

  /* ---------- Draw everything that depends on rain, hour or data ---------- */
  function refreshAll() {
    recompute(); drawBanner(); drawList();
    if (map) { restyleAll(); drawRain(); drawLegend(); }
    renderCard();
  }

  /* ---------- Start ---------- */
  fillPlaces(); recompute(); drawBanner(); drawList(); drawLegend();
  FDA.rain.load().then(refreshAll);

  /* ---------- Weather banner: shown when the QC flood risk is moderate or higher ---------- */
  var wxBanner = $("#wx-banner");
  function drawWeatherBanner() {
    var w = FDA.weather.get();
    if (!w || w.risk === "low") { wxBanner.hidden = true; return; }
    wxBanner.hidden = false;
    wxBanner.className = "wx-banner wx-banner--" + w.risk;
    wxBanner.innerHTML = "<strong>" + FDA.ui.svg("possible-flood", "md") + FDA.weather.words[w.risk] + " flood risk · Quezon City</strong>" +
      "<small>" + w.soonMm + " mm/h of rain in the next few hours · " + w.next24mm + " mm expected in 24 h" + (w.stale ? " · offline copy from " + FDA.ui.clock(w.at) : "") + "</small>" +
      "<small>Estimate from forecast rain using PAGASA-style levels, not an official warning.</small>";
  }
  window.addEventListener("fda:weather", drawWeatherBanner);
  FDA.weather.load();

  FDA.mapkit.create($("#map")).then(function (m) {
    map = m; L = window.L;
    polyGroup = L.geoJSON(FDA.hazard.geojson(), {
      style: function (f) { return polyStyle(f.properties.name); },
      onEachFeature: function (f, layer) {
        var name = f.properties.name; polys[name] = layer;
        layer.bindTooltip(name, { sticky: true, direction: "top" });
        layer.on({
          mouseover: function () { setHover(name); }, mouseout: function () { setHover(null); },
          click: function (e) { L.DomEvent.stopPropagation(e); select(name); }
        });
      }
    }).addTo(map);
    map.fitBounds(polyGroup.getBounds());
    map.on("click", function () { if (state.pinStreet) { state.pinStreet = null; renderCard(); } });
    map.on("zoomend", function () { drawReports(); });
    drawSpots(); drawReports(); drawRain(); drawLegend();
    drawQcHazard();
    FDA.possibleFloodingLayer.init(map, {
      legend: $("#pf-legend"), list: $("#pf-list"), sub: $("#l-possible-sub"),
      pick: function (name) { select(name); FDA.possibleFloodingLayer.openPopup(name); }
    });

    var hashB = /[#&]b=([^&]+)/.exec(location.hash), qB = FDA.ui.param("b");
    var rep = wantReport && FDA.store.db().reports.filter(function (r) { return r.id === wantReport; })[0];
    var start = qB || (hashB && decodeURIComponent(hashB[1])) || (rep && rep.barangay);
    if (rep) { state.statuses[rep.status] = true; $$("#report-filters .chip").forEach(function (b) { b.setAttribute("aria-pressed", String(state.statuses[b.dataset.status])); }); if (Date.now() - rep.ts > 24 * 3600000) { state.windowH = 168; $("#map-time").value = "168"; } drawReports(); }
    if (start && FDA.hazard.get(start)) select(start);
    if (rep && wantMarker) { map.setView([rep.lat, rep.lng], 16); wantMarker.openPopup(); }
  }).catch(function (err) {
    var f = $("#map-fallback"); f.hidden = false; f.textContent = err.message + " The lists on the left still work.";
  });
})();
