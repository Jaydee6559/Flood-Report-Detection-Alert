/**
 * Flood map (mock map): filters, search, zoom levels, markers and clusters
 * all come from the saved reports. The drawing behind the markers is the
 * design's illustration, so marker positions are relative, not geographic.
 * TODO (backend): swap the illustration for Leaflet + OpenStreetMap tiles.
 */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var db = FDA.store.db();

  var STATUSES = ["flood-warning", "possible-flood", "unclear-photo", "no-flood"];
  var CLS = { "flood-warning": "warning", "possible-flood": "possible", "unclear-photo": "unclear", "no-flood": "no-flood" };
  var HOURS = [{ label: "Last 24 hours", h: 24 }, { label: "Last 3 days", h: 72 }, { label: "Last 7 days", h: 168 }];
  var CLUSTER_AT = { "Quezon City": [47, 32] }; // where each city's cluster sits on the country illustration

  var search = $("#map-search"), mSearch = $(".map-mobile-top input[type=search]");
  var chips = $$(".map-sidebar .chip-row .chip");
  var timeSel = $("#map-time"), outdatedSw = $(".switch-row .switch");
  var cityCanvas = $(".map-canvas--city"), countryCanvas = $(".map-canvas--country");
  var popup = $(".map-popup"), areaUl = $(".area-list ul"), areaTitle = $(".area-list__head h2");

  var state = {
    statuses: { "flood-warning": true, "possible-flood": true, "unclear-photo": false, "no-flood": false },
    hours: 24, outdated: true, query: "Quezon City", selected: null
  };

  // On a phone the map starts zoomed out on the whole country, like the design
  if (window.matchMedia && window.matchMedia("(max-width: 899px)").matches) state.query = "";
  var wantId = +FDA.ui.param("id");
  var wanted = db.reports.filter(function (r) { return r.id === wantId; })[0];
  if (wanted) {
    state.query = wanted.barangay + ", " + wanted.city; state.selected = wanted.id; state.statuses[wanted.status] = true;
    state.hours = Math.max(24, Math.ceil((Date.now() - wanted.ts) / 3600000)) <= 24 ? 24 : 168;
  }

  $$("option", timeSel).forEach(function (o) { if (o.textContent === "Today") o.textContent = "Last 24 hours"; });
  timeSel.value = HOURS.filter(function (x) { return x.h === state.hours; })[0].label;

  function words(q) { return q.toLowerCase().split(/[,\s]+/).filter(Boolean); }
  function inScope(r, q) {
    var text = (r.street + " " + r.barangay + " " + r.city).toLowerCase();
    return words(q).every(function (w) { return text.indexOf(w) >= 0 || (w === "city" || w === "brgy." || w === "brgy"); });
  }

  function visible(applyScope) {
    var now = Date.now();
    return db.reports.filter(function (r) {
      if (r.removed || !state.statuses[r.status] || now - r.ts > state.hours * 3600000) return false;
      if (!state.outdated && !FDA.agent.isRecent(r, now)) return false;
      return applyScope === false || inScope(r, state.query);
    }).sort(function (a, b) { return b.ts - a.ts; });
  }

  /* ---------- Scope and breadcrumb ---------- */
  function scope() {
    var hit = FDA.geo.resolve(state.query);
    return hit ? { city: hit.city, barangay: hit.barangay || null } : { city: null, barangay: null };
  }
  function setScope(city, barangay) {
    state.query = barangay ? barangay + ", " + city : city || "";
    search.value = state.query; if (mSearch) mSearch.value = state.query;
    state.selected = null; render();
  }
  function crumbs() {
    var s = scope(), nav = $(".map-crumbs");
    var html = '<a href="#" data-all="1">Philippines</a>';
    if (s.city) html += '<span aria-hidden="true">›</span><a href="#" data-metro="1">Metro Manila</a><span aria-hidden="true">›</span>' + (s.barangay ? '<a href="#" data-city="' + esc(s.city) + '">' + esc(s.city) + "</a>" : "<strong>" + esc(s.city) + "</strong>");
    if (s.barangay) html += '<span aria-hidden="true">›</span><strong>' + esc(s.barangay.replace("Brgy. ", "Brgy. ")) + "</strong>";
    nav.innerHTML = html;
  }
  $(".map-crumbs").addEventListener("click", function (e) {
    var a = e.target.closest("a"); if (!a) return; e.preventDefault();
    if (a.dataset.all || a.dataset.metro) setScope(""); else setScope(a.dataset.city);
  });

  /* ---------- Drawing ---------- */
  function projector(rows) {
    var lats = rows.map(function (r) { return r.lat; }), lngs = rows.map(function (r) { return r.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats), minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var spanLat = Math.max(maxLat - minLat, 0.006), spanLng = Math.max(maxLng - minLng, 0.009);
    var cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
    return function (r) {
      var x = 50 + ((r.lng - cLng) / (spanLng * 1.35)) * 100, y = 50 - ((r.lat - cLat) / (spanLat * 1.35)) * 100;
      return { x: Math.max(9, Math.min(91, x)), y: Math.max(14, Math.min(86, y)) };
    };
  }

  function drawMarkers(rows) {
    $$(".map-marker", cityCanvas).forEach(function (m) { m.remove(); });
    var project = projector(rows.length ? rows : [{ lat: 14.645, lng: 121.04 }]);
    var placed = [];
    // Reports a few metres apart would sit on top of each other and could not be clicked,
    // so each marker that lands too close to an earlier one is moved to the nearest free spot around it.
    function free(p) { return placed.every(function (q) { return Math.abs(q.x - p.x) > 4.2 || Math.abs(q.y - p.y) > 7.5; }); }
    function spread(p) {
      if (free(p)) return p;
      for (var ring = 1; ring <= 6; ring++) for (var k = 0; k < 6 * ring; k++) {
        var ang = (k / (6 * ring)) * Math.PI * 2, c = { x: p.x + Math.cos(ang) * 5 * ring, y: p.y + Math.sin(ang) * 8.5 * ring };
        if (c.x > 6 && c.x < 94 && c.y > 10 && c.y < 90 && free(c)) return c;
      }
      return p;
    }
    rows.forEach(function (r) {
      var p = spread(project(r)); placed.push(p);
      var pin = r.status === "no-flood" ? FDA.ui.icon.check : FDA.ui.icon[r.status];
      var d = document.createElement("div");
      d.className = "map-marker map-marker--" + CLS[r.status] + (FDA.agent.isRecent(r) ? "" : " map-marker--faded") + (r.id === state.selected ? " map-marker--selected" : "");
      d.style.cssText = "--x: " + p.x.toFixed(1) + "%; --y: " + p.y.toFixed(1) + "%; cursor: pointer";
      d.tabIndex = 0; d.setAttribute("role", "button"); d.dataset.id = r.id;
      d.setAttribute("aria-label", "Report #" + r.id + ", " + FDA.agent.label(r.status));
      d.innerHTML = '<span class="map-marker__pin"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + pin + '</svg></span><span class="map-marker__label">#' + r.id + "</span>";
      cityCanvas.insertBefore(d, popup);
    });
  }

  function drawPopup(rows) {
    var r = rows.filter(function (x) { return x.id === state.selected; })[0];
    popup.hidden = !r;
    if (!r) return;
    popup.setAttribute("aria-label", "Report #" + r.id + " preview");
    popup.innerHTML =
      '<div class="map-popup__row"><img class="map-popup__thumb" src="' + esc(r.photo) + '" alt=""><div><p class="map-popup__title">#' + r.id + " · " + esc(r.street) + '</p><p class="map-popup__meta">' + esc(r.barangay.replace(/, .*/, "")) + " · " + FDA.ui.clock(r.ts) + " · " + FDA.ui.timeAgo(r.ts) + "</p></div></div>" +
      '<div class="map-popup__badges">' + FDA.ui.badge(r.status) + '<span class="map-popup__prob">' + Math.round(r.prob * 100) + "%</span></div>" +
      '<div class="map-popup__foot"><span>' + r.still + ' still flooded</span><a class="link" href="report-details.html?id=' + r.id + '">View report →</a></div>';
  }

  function drawList(rows) {
    areaTitle.textContent = "In this area (" + rows.length + ")";
    areaUl.innerHTML = rows.length ? rows.map(function (r) {
      var old = !FDA.agent.isRecent(r);
      return '<li><a class="area-item' + (old ? " area-item--faded" : "") + '" href="report-details.html?id=' + r.id + '" data-id="' + r.id + '"><span class="area-item__top">' + FDA.ui.badge(r.status) +
        '<span class="area-item__street">' + esc(r.street) + '</span></span><span class="area-item__meta">#' + r.id + " · " + FDA.ui.timeAgo(r.ts) + (old ? " · may be outdated" : "") + "</span></a></li>";
    }).join("") : '<li class="text-small text-muted" style="padding:12px 4px">No reports match. Try another area or turn on more statuses.</li>';
  }

  function drawClusters() {
    $$(".cluster, .cluster-label", countryCanvas).forEach(function (c) { c.remove(); });
    var all = visible(false), byCity = {};
    all.forEach(function (r) { (byCity[r.city] = byCity[r.city] || []).push(r); });
    Object.keys(byCity).forEach(function (city) {
      var rows = byCity[city], pos = CLUSTER_AT[city] || [45, 36];
      var worst = STATUSES.filter(function (s) { return rows.some(function (r) { return r.status === s; }); })[0];
      var el = document.createElement("span");
      el.className = "cluster cluster--" + CLS[worst] + (rows.length > 4 ? " cluster--lg" : "");
      el.style.cssText = "--x: " + pos[0] + "%; --y: " + pos[1] + "%; --size: " + (rows.length > 4 ? 40 : 26) + "px; cursor: pointer";
      el.textContent = rows.length; el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-label", city + ": " + rows.length + " reports"); el.dataset.city = city;
      countryCanvas.appendChild(el);
    });
    var label = document.createElement("span");
    label.className = "cluster-label"; label.style.cssText = "--x: 52%; --y: 36%"; label.textContent = "Metro Manila";
    if (all.length) countryCanvas.appendChild(label);
  }

  function drawSheet() {
    var s = scope(), rows = visible(true), all = visible(false), box = $(".map-sheet");
    $(".map-sheet__head h1").textContent = (s.barangay || s.city || "Philippines") + " · " + rows.length + " report" + (rows.length === 1 ? "" : "s");
    $(".map-sheet__hint").textContent = s.city ? "Tap a report to open it." : "Tap a number to zoom to the city, then the barangay.";
    var count = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
    var row = $(".chip-row", box);
    row.innerHTML = FDA.ui.badge("flood-warning").replace("Flood warning", "Warning · " + count("flood-warning")) +
      FDA.ui.badge("possible-flood").replace("Possible flood", "Possible · " + count("possible-flood")) +
      '<span class="badge badge--unclear-photo">+' + (count("unclear-photo") + count("no-flood")) + "</span>";
    var list = $(".map-sheet__list", box);
    if (!list) { list = document.createElement("ul"); list.className = "map-sheet__list"; list.style.cssText = "list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px;max-height:140px;overflow:auto"; box.appendChild(list); }
    list.innerHTML = s.city ? rows.map(function (r) {
      return '<li><a class="area-item" href="report-details.html?id=' + r.id + '"><span class="area-item__top">' + FDA.ui.badge(r.status) + '<span class="area-item__street">' + esc(r.street) + '</span></span><span class="area-item__meta">#' + r.id + " · " + FDA.ui.timeAgo(r.ts) + "</span></a></li>";
    }).join("") : "";
    void all;
  }

  function syncFilterChips() {
    chips.forEach(function (c, i) { c.setAttribute("aria-pressed", String(!!state.statuses[STATUSES[i]])); });
    var n = STATUSES.filter(function (s) { return state.statuses[s]; }).length;
    var mf = $$(".map-mobile-top .chip")[0]; if (mf) mf.lastChild.textContent = "Filters · " + n;
    var mt = $$(".map-mobile-top .chip")[1]; if (mt) mt.textContent = HOURS.filter(function (x) { return x.h === state.hours; })[0].label.replace("Last 24 hours", "Today");
    timeSel.value = HOURS.filter(function (x) { return x.h === state.hours; })[0].label;
    outdatedSw.setAttribute("aria-checked", String(state.outdated));
  }

  function render() {
    var rows = visible(true);
    if (state.selected && !rows.some(function (r) { return r.id === state.selected; })) state.selected = null;
    crumbs(); drawMarkers(rows); drawPopup(rows); drawList(rows); drawClusters(); drawSheet(); syncFilterChips();
  }

  function select(id) { state.selected = id; render(); }

  /* ---------- Events ---------- */
  cityCanvas.addEventListener("click", function (e) { var m = e.target.closest(".map-marker"); if (m) select(+m.dataset.id); });
  cityCanvas.addEventListener("keydown", function (e) { var m = e.target.closest(".map-marker"); if (m && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(+m.dataset.id); } });
  countryCanvas.addEventListener("click", function (e) { var c = e.target.closest(".cluster"); if (c) setScope(c.dataset.city); });
  countryCanvas.addEventListener("keydown", function (e) { var c = e.target.closest(".cluster"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setScope(c.dataset.city); } });
  areaUl.addEventListener("mouseover", function (e) { var a = e.target.closest(".area-item"); if (a && a.dataset.id && +a.dataset.id !== state.selected) { state.selected = +a.dataset.id; drawMarkers(visible(true)); drawPopup(visible(true)); } });

  FDA.ui.bindChips(chips, "multi", function () {
    chips.forEach(function (c, i) { state.statuses[STATUSES[i]] = c.getAttribute("aria-pressed") === "true"; });
    render();
  });
  timeSel.addEventListener("change", function () { state.hours = HOURS.filter(function (x) { return x.label === timeSel.value; })[0].h; render(); });
  FDA.ui.bindSwitch(outdatedSw, state.outdated, function (v) { state.outdated = v; render(); });

  function onSearch(src) { return function () { state.query = src.value; var other = src === search ? mSearch : search; if (other) other.value = src.value; state.selected = null; render(); }; }
  search.value = state.query; search.addEventListener("input", onSearch(search));
  if (mSearch) { mSearch.value = state.query; mSearch.addEventListener("input", onSearch(mSearch)); }

  var controls = $$(".map-controls .map-control");
  controls[0].addEventListener("click", function () { // zoom in: all → city → barangay of the newest report
    var s = scope(), rows = visible(true);
    if (!rows.length) return FDA.ui.toast("No reports in view to zoom into.");
    if (!s.city) setScope(rows[0].city); else if (!s.barangay) setScope(rows[0].city, rows[0].barangay);
  });
  controls[1].addEventListener("click", function () { var s = scope(); if (s.barangay) setScope(s.city); else setScope(""); });
  controls[2].addEventListener("click", function () {
    FDA.geo.locate().then(function (p) { var n = FDA.geo.nearest(p.lat, p.lng); if (n && n.meters < 8000) setScope(n.city, n.barangay); else FDA.ui.toast("You seem to be outside the areas in this prototype.", "error"); })
      .catch(function (err) { FDA.ui.toast(err.message, "error"); });
  });

  /* Phone: Filters dialog, Today cycle, Legend */
  var mChips = $$(".map-mobile-top .chip");
  if (mChips.length === 3) {
    mChips[0].addEventListener("click", function () {
      var html = STATUSES.map(function (s) { return '<label class="checkbox" style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" data-s="' + s + '"' + (state.statuses[s] ? " checked" : "") + "> " + esc(FDA.agent.label(s)) + "</label>"; }).join("");
      FDA.ui.dialog({ title: "Filter by status", html: html, confirm: "Apply" });
      var dlg = $("dialog.fda-dialog");
      // read the boxes when the form is sent, before the dialog is removed
      dlg.querySelector("form").addEventListener("submit", function () {
        $$("[data-s]", dlg).forEach(function (b) { state.statuses[b.dataset.s] = b.checked; });
        setTimeout(render, 0);
      });
    });
    mChips[1].addEventListener("click", function () { var i = HOURS.findIndex(function (x) { return x.h === state.hours; }); state.hours = HOURS[(i + 1) % HOURS.length].h; render(); });
    mChips[2].addEventListener("click", function () { FDA.ui.dialog({ title: "Legend", html: $(".map-legend").innerHTML, cancel: false, confirm: "Close" }); });
  }

  if (wanted) { search.value = state.query; if (mSearch) mSearch.value = state.query; }
  render();
})();
