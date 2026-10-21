/** My routes: save routes, see the reports along each one, turn alerts on or off */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var db = FDA.store.db(), user = FDA.auth.current();

  var listUl = $(".route-list"), detail = $(".route-detail");
  var routeIcon = $(".route-card__title svg").outerHTML, editIcon = $(".route-card__edit svg").outerHTML;
  var f = { name: $("#route-name"), start: $("#route-start"), end: $("#route-end") };
  var editor = $(".route-editor");
  var selectedId = +FDA.ui.param("id") || null;

  function mine() { return db.routes.filter(function (r) { return r.userId === user.id; }); }
  function byId(id) { return mine().filter(function (r) { return r.id === id; })[0]; }
  function check(route) { return FDA.agent.routeCheck(route, db.reports); }

  function km(route) {
    var a = FDA.geo.resolve(route.start), b = FDA.geo.resolve(route.end);
    return a && b ? "about " + (FDA.geo.distance(a, b) / 1000).toFixed(1) + " km" : "distance unknown";
  }

  function badgeFor(res) {
    if (res.level === "warning") return FDA.ui.badge("flood-warning").replace("Flood warning", res.warnings.length + " flood warning" + (res.warnings.length > 1 ? "s" : "") + " on route");
    if (res.level === "possible") return FDA.ui.badge("possible-flood").replace("Possible flood", res.possible.length + " possible flood" + (res.possible.length > 1 ? "s" : "") + " near route");
    return FDA.ui.badge("no-flood").replace("No flood", "No recent reports");
  }

  function drawList() {
    var routes = mine();
    listUl.innerHTML = routes.length ? routes.map(function (r) {
      return '<li><a class="route-card' + (r.id === selectedId ? " route-card--selected" : "") + '" href="routes.html?id=' + r.id + '"' + (r.id === selectedId ? ' aria-current="true"' : "") + ">" +
        '<span class="route-card__title">' + routeIcon + esc(r.name) + '</span><span class="route-card__places">' + esc(r.start + " → " + r.end) + "</span>" + badgeFor(check(r)) + "</a>" +
        '<button class="route-card__edit" type="button" data-id="' + r.id + '" aria-label="Edit ' + esc(r.name) + '">' + editIcon + "</button></li>";
    }).join("") : '<li class="card card--soft card--padded text-small">You have no saved routes yet. Add one below to get flood alerts.</li>';
  }

  /* ---------- Real map of the route (Leaflet): start, end, hazard zones and the reports near it ---------- */
  var rmaps = [];
  $$(".route-map").forEach(function (el) {
    el.innerHTML = '<div class="route-map__canvas" role="img" aria-label="Map of the route with nearby flood reports"></div>';
    var rec = { el: el.firstChild, map: null, layer: null, pending: null };
    rmaps.push(rec);
    FDA.mapkit.create(rec.el).then(function (m) {
      var L = window.L; rec.map = m; rec.layer = L.layerGroup().addTo(m);
      L.geoJSON(FDA.hazard.geojson(), { interactive: false, style: function (f) { var h = f.properties.hazard; return { color: "#fff", weight: 0.5, fillColor: FDA.mapkit.HAZARD[h], fillOpacity: h === "none" ? 0 : 0.28 }; } }).addTo(m);
      if (rec.pending) paintMap(rec, rec.pending.route, rec.pending.res);
    }).catch(function () { rec.el.innerHTML = '<p class="text-small text-muted" style="padding:16px">The map could not be loaded. The list below still works.</p>'; });
  });
  function paintMap(rec, route, res) {
    var L = window.L, a = FDA.geo.resolve(route.start), b = FDA.geo.resolve(route.end), pts = [];
    rec.layer.clearLayers();
    if (a && b) { L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: "#0b5d98", weight: 5, opacity: 0.85, dashArray: "8 8" }).addTo(rec.layer); }
    [[a, "Start: " + route.start, "A"], [b, "Destination: " + route.end, "B"]].forEach(function (x) {
      if (!x[0]) return; pts.push([x[0].lat, x[0].lng]);
      L.marker([x[0].lat, x[0].lng], { title: x[1], icon: L.divIcon({ className: "fda-pin fda-pin--route", html: "<span>" + x[2] + "</span>", iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(rec.layer);
    });
    res.items.forEach(function (i) {
      var r = i.report; if (r.lat == null) return; pts.push([r.lat, r.lng]);
      L.marker([r.lat, r.lng], { icon: FDA.mapkit.statusIcon(L, r.status, ""), opacity: i.recent ? 1 : 0.55, title: "#" + r.id + " " + FDA.agent.label(r.status) })
        .bindPopup("<strong>#" + r.id + " " + esc(FDA.agent.label(r.status)) + "</strong><br>" + esc(r.street) + "<br>" + i.where + " · " + FDA.ui.timeAgo(r.ts) + '<br><a href="report-details.html?id=' + r.id + '">Open report</a>').addTo(rec.layer);
    });
    rec.map.invalidateSize();
    if (pts.length) rec.map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
  }
  function drawMaps(route) {
    var res = check(route);
    rmaps.forEach(function (rec) { if (rec.map) paintMap(rec, route, res); else rec.pending = { route: route, res: res }; });
  }
  window.addEventListener("resize", function () { rmaps.forEach(function (r) { if (r.map) r.map.invalidateSize(); }); });

  function drawDetail() {
    var route = byId(selectedId);
    detail.hidden = !route;
    if (!route) return;
    var res = check(route);
    $("#route-title").textContent = route.name;
    $(".route-detail__head p").textContent = route.start + " → " + route.end + " · " + km(route);
    $(".route-detail__aside .badge--sample").textContent = "DEMO DATA";
    $(".route-detail__aside a").href = "schedules.html?route=" + route.id;

    var alert = $(".route-alert"), clear = $(".route-clear");
    var top = res.warnings[0];
    alert.hidden = !top;
    if (top) {
      $(".route-alert__title").textContent = res.warnings.length > 1 ? res.warnings.length + " flood warnings on your route" : "Flood warning on your route";
      $(".route-alert__text").textContent = "#" + top.report.id + " · " + top.report.street + ", " + top.report.barangay.replace(/, .*/, "") + " · reported " + FDA.ui.timeAgo(top.report.ts) + " · " + top.report.still + " still-flooded confirmation" + (top.report.still === 1 ? "" : "s");
      $(".route-alert .btn").href = "report-details.html?id=" + top.report.id;
    }
    if (!clear) { clear = document.createElement("p"); clear.className = "callout callout--success route-clear"; alert.insertAdjacentElement("afterend", clear); }
    clear.hidden = !!top;
    clear.textContent = res.level === "possible" ? "No confirmed flood warning on this route, but there are possible floods nearby. Use caution."
      : res.resolved ? "No recent flood reports along this route. Check local conditions before leaving."
        : "We could not place this route on the map, so only reports with a matching barangay or street name are shown.";

    $(".near-head h3").textContent = "Reports near this route (" + res.items.length + ")";
    $(".near-head span").textContent = "Faded: may be outdated";
    $(".near-list").innerHTML = res.items.length ? res.items.map(function (i) {
      return '<li><a class="near-item" style="' + (i.recent ? "" : "opacity:.55") + '" href="report-details.html?id=' + i.report.id + '"><span class="near-item__top">' + FDA.ui.badge(i.report.status) +
        '<span class="near-item__street">' + esc(i.report.street) + '</span></span><span class="near-item__meta">' + i.where + " · " + FDA.ui.timeAgo(i.report.ts) + (i.recent ? "" : " · may be outdated") + "</span></a></li>";
    }).join("") : '<li class="text-small text-muted">No reports near this route.</li>';

    drawMaps(route);
    FDA.ui.bindSwitchOnce($(".alert-toggle .switch"), route.alert, function (v) { route.alert = v; FDA.store.save(); FDA.ui.toast(v ? "Route alerts on." : "Route alerts off."); drawEditor(); });
  }

  /* ---------- Phone editor ---------- */
  var mName = $("#m-route-name"), mPoints = $$(".route-point__value", editor), mSwitch = $(".route-editor .switch"), mNow = $(".route-now"), mSave = $(".route-editor .btn--primary"), mBack = $(".route-editor__back");
  mPoints.forEach(function (p, i) { // make start/destination editable so new routes can be created on a phone
    var inp = document.createElement("input"); inp.className = "form-input"; inp.setAttribute("aria-label", i ? "Destination" : "Start point"); inp.placeholder = "Barangay or landmark";
    p.replaceWith(inp); mPoints[i] = inp;
  });
  function drawEditor() {
    var route = byId(selectedId);
    mName.value = route ? route.name : ""; mPoints[0].value = route ? route.start : ""; mPoints[1].value = route ? route.end : "";
    FDA.ui.bindSwitchOnce(mSwitch, route ? route.alert : true, function (v) { if (route) { route.alert = v; FDA.store.save(); drawDetail(); } });
    var strong = mNow.querySelector("strong").outerHTML;
    if (route) { var res = check(route), top = res.warnings[0] || res.possible[0]; mNow.innerHTML = strong + (top ? FDA.agent.label(top.report.status) + " on " + esc(top.report.street) + " · " + FDA.ui.timeAgo(top.report.ts) : "No recent flood reports on this route"); }
    else mNow.innerHTML = strong + "Save the route to see its status";
    mBack.lastChild.textContent = route ? " New route" : " New route";
    $(".route-editor .btn--primary").textContent = route ? "Save route" : "Add route";
  }
  mBack.addEventListener("click", function (e) { e.preventDefault(); selectedId = null; render(); });
  mSave.addEventListener("click", function () { saveRoute(mName.value, mPoints[0].value, mPoints[1].value, byId(selectedId)); });

  /* ---------- Save / edit / delete ---------- */
  function saveRoute(name, start, end, existing, inputs) {
    name = name.trim(); start = start.trim(); end = end.trim();
    if (inputs) Object.keys(inputs).forEach(function (k) { FDA.ui.fieldError(inputs[k], ""); });
    var bad = false;
    if (!name) { bad = true; inputs ? FDA.ui.fieldError(inputs.name, "Give the route a name.") : FDA.ui.toast("Give the route a name.", "error"); }
    if (!start) { bad = true; inputs ? FDA.ui.fieldError(inputs.start, "Enter a start point.") : FDA.ui.toast("Enter a start point.", "error"); }
    if (!end) { bad = true; inputs ? FDA.ui.fieldError(inputs.end, "Enter a destination.") : FDA.ui.toast("Enter a destination.", "error"); }
    if (bad) return;
    if (!FDA.geo.resolve(start) || !FDA.geo.resolve(end)) FDA.ui.toast("We could not place one of those on the map, so reports will be matched by name only.");
    if (existing) { existing.name = name; existing.start = start; existing.end = end; }
    else { existing = { id: FDA.store.nextId("nextRoute"), userId: user.id, name: name, start: start, end: end, alert: true }; db.routes.push(existing); }
    FDA.store.save(); selectedId = existing.id;
    Object.keys(f).forEach(function (k) { f[k].value = ""; });
    FDA.ui.toast("Route saved.", "success"); render();
  }
  $(".add-route .btn--primary").addEventListener("click", function () { saveRoute(f.name.value, f.start.value, f.end.value, null, f); });
  $(".add-route").addEventListener("submit", function (e) { e.preventDefault(); saveRoute(f.name.value, f.start.value, f.end.value, null, f); });

  listUl.addEventListener("click", function (e) {
    var b = e.target.closest(".route-card__edit"); if (!b) return;
    var route = byId(+b.dataset.id);
    FDA.ui.dialog({
      title: "Edit route", confirm: "Save changes", extra: { label: "Delete route", danger: true },
      fields: [{ name: "name", label: "Route name", value: route.name, required: true }, { name: "start", label: "Start point", value: route.start, required: true }, { name: "end", label: "Destination", value: route.end, required: true }]
    }).then(function (res) {
      if (res === "extra") {
        FDA.ui.dialog({ title: "Delete “" + route.name + "”?", text: "Its travel schedules will be deleted too.", confirm: "Delete", danger: true }).then(function (ok) {
          if (!ok) return;
          db.routes = db.routes.filter(function (r) { return r.id !== route.id; });
          db.schedules = db.schedules.filter(function (s) { return s.routeId !== route.id; });
          FDA.store.save(); if (selectedId === route.id) selectedId = null; render(); FDA.ui.toast("Route deleted.");
        });
      } else if (res) saveRoute(res.name, res.start, res.end, route);
    });
  });

  function render() {
    if (!byId(selectedId)) selectedId = mine()[0] ? mine()[0].id : null;
    drawList(); drawDetail(); drawEditor();
    history.replaceState(null, "", selectedId ? "routes.html?id=" + selectedId : "routes.html");
  }
  render();
})();
