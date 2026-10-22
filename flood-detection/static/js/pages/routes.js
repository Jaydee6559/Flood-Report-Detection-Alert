/** My routes: save routes that follow real streets, see the reports along each one, turn alerts on or off */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var db = FDA.store.db(), user = FDA.auth.current();
  var CITY = "Quezon City";

  var listUl = $(".route-list"), detail = $(".route-detail");
  var routeIcon = '<svg class="icon icon--md" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8.4 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.6"/></svg>';
  var editIcon = '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
  var editor = $(".route-editor");
  var selectedId = +FDA.ui.param("id") || null;
  var planState = {};   // route id -> {busy} or {error} while a stored route is being placed on the streets
  var STATUS_WORDS = { ok: "No recent reports", possible: "Possible flood", warning: "Flood warning" };
  var STATUS_COLORS = { ok: "#1d6b3a", possible: "#c2570c", warning: "#b8291f" };

  function mine() { return db.routes.filter(function (r) { return r.userId === user.id; }); }
  function byId(id) { return mine().filter(function (r) { return r.id === id; })[0]; }
  function check(route) { return FDA.agent.routeCheck(route, db.reports); }
  function placed(route) { return !!(route.geometry && route.geometry.length > 1 && route.segments && route.segments.length); }
  function label(pt) { return pt.name || (pt.street ? pt.street + ", " + pt.barangay : pt.barangay); }
  /** A point on the street inside the chosen barangay (a long street's middle can lie in another barangay). */
  function streetPoint(barangay, street) {
    var inside = [];
    street.lines.forEach(function (line) { line.forEach(function (p) { if (FDA.hazard.contains(barangay, p[0], p[1])) inside.push(p); }); });
    if (inside.length) { var m = inside[Math.floor(inside.length / 2)]; return { lat: m[0], lng: m[1] }; }
    return FDA.streets.center(street);
  }

  function km(route) {
    return route.distanceM ? "about " + (route.distanceM / 1000).toFixed(1) + " km by road" : "distance unknown until the route is placed";
  }

  function badgeFor(route, res) {
    var ps = planState[route.id];
    if (ps && ps.busy) return '<span class="badge badge--unclear-photo">Finding the route…</span>';
    if (res.level === "unplaced") return '<span class="badge badge--unclear-photo">Route not placed</span>';
    if (res.level === "warning") return FDA.ui.badge("flood-warning").replace("Flood warning", res.warnings.length + " flood warning" + (res.warnings.length > 1 ? "s" : "") + " on route");
    if (res.level === "possible") return FDA.ui.badge("possible-flood").replace("Possible flood", res.possible.length + " possible flood" + (res.possible.length > 1 ? "s" : "") + " near route");
    return FDA.ui.badge("no-flood").replace("No flood", "No recent reports");
  }

  function drawList() {
    var routes = mine();
    listUl.innerHTML = routes.length ? routes.map(function (r) {
      return '<li><a class="route-card' + (r.id === selectedId ? " route-card--selected" : "") + '" href="routes.html?id=' + r.id + '"' + (r.id === selectedId ? ' aria-current="true"' : "") + ">" +
        '<span class="route-card__title">' + routeIcon + esc(r.name) + '</span><span class="route-card__places">' + esc(r.start + " → " + r.end) + "</span>" + badgeFor(r, check(r)) + "</a>" +
        '<button class="route-card__edit" type="button" data-id="' + r.id + '" aria-label="Edit ' + esc(r.name) + '">' + editIcon + "</button></li>";
    }).join("") : '<li class="card card--soft card--padded text-small">You have no saved routes yet. Add one below to get flood alerts.</li>';
  }

  /* ---------- Place pickers: District -> Barangay -> Street, with a landmark box as a fallback ---------- */
  function Picker(host, title, onChange) {
    var id = "pt" + Math.random().toString(36).slice(2, 7);
    host.innerHTML = '<fieldset class="pt"><legend class="form-label">' + esc(title) + "</legend>" +
      '<div class="pt__row"><select class="form-select" data-k="district" aria-label="' + esc(title) + ' district"></select>' +
      '<select class="form-select" data-k="barangay" aria-label="' + esc(title) + ' barangay"></select></div>' +
      '<select class="form-select" data-k="street" aria-label="' + esc(title) + ' street" disabled></select>' +
      '<input class="form-input" data-k="landmark" type="text" id="' + id + '" placeholder="Or a landmark, e.g. UP Diliman" aria-label="' + esc(title) + ' landmark">' +
      '<p class="form-hint pt__hint" data-k="hint" role="status"></p></fieldset>';
    var el = {};
    $$("[data-k]", host).forEach(function (n) { el[n.dataset.k] = n; });
    var streets = [], token = 0, kept = null;   // kept = the saved point, used until the person changes this picker
    function changed() { kept = null; if (onChange) onChange(); }

    function fill(sel, first, items) {
      sel.innerHTML = ""; sel.appendChild(new Option(first, ""));
      items.forEach(function (n) { sel.appendChild(n instanceof Option ? n : new Option(n, n)); });
    }
    function hint(text, bad) { el.hint.textContent = text || ""; el.hint.classList.toggle("pt__hint--error", !!bad); }
    function fillBarangays(district) {
      fill(el.barangay, "Barangay", FDA.geo.barangays(CITY).filter(function (n) { return !district || String(FDA.geo.districtOf(CITY, n)) === String(district); }));
    }
    fill(el.district, "District", FDA.geo.districts(CITY).map(function (d) { return new Option("District " + d.id, d.id); }));
    fillBarangays(""); fill(el.street, "Street (optional)", []);

    function loadStreets(name, keep) {
      var mine_ = ++token; streets = []; fill(el.street, "Street (optional)", []); el.street.disabled = true;
      if (!name) { hint(""); return Promise.resolve(); }
      hint("Loading streets…");
      return FDA.streets.load(name).then(function (res) { return res.streets; }, function () {
        var cached = []; try { cached = JSON.parse(localStorage.getItem("fda.street-names." + name)) || []; } catch (e) { /* none saved */ }
        return cached.map(function (n) { return { name: n, lines: null }; });
      }).then(function (list) {
        if (mine_ !== token) return;
        streets = list;
        fill(el.street, list.length ? "Street (optional)" : "No streets found", list.map(function (s) { return s.name; }));
        el.street.disabled = !list.length;
        if (keep) el.street.value = keep;
        var noPos = list.some(function (s) { return !s.lines; });
        hint(list.length ? (noPos ? "Street positions are unavailable right now, so the barangay centre is used." : "Pick a street, or leave it to start from the barangay centre.") : "OpenStreetMap has no named streets for this barangay. The barangay centre is used.");
      });
    }
    el.district.addEventListener("change", function () { kept = null; fillBarangays(el.district.value); loadStreets(""); });
    el.barangay.addEventListener("change", function () {
      if (el.barangay.value) el.district.value = FDA.geo.districtOf(CITY, el.barangay.value) || el.district.value;
      loadStreets(el.barangay.value); changed();
    });
    el.street.addEventListener("change", changed);
    el.landmark.addEventListener("change", changed);

    return {
      el: host,
      /** {point: {barangay, street, lat, lng, name?}} or {error} */
      value: function () {
        if (kept) return { point: kept };
        var b = el.barangay.value;
        if (b) {
          var s = streets.filter(function (x) { return x.name === el.street.value; })[0], c;
          if (s && s.lines) c = streetPoint(b, s);
          else { var h = FDA.hazard.get(b); c = h ? { lat: h.lat, lng: h.lng } : FDA.geo.point(CITY, b); }
          return { point: { barangay: b, street: el.street.value || "", lat: c.lat, lng: c.lng } };
        }
        var text = el.landmark.value.trim();
        if (!text) return { error: "Pick a barangay or type a landmark." };
        var r = FDA.geo.resolve(text);
        if (!r) return { error: "We could not find “" + text + "”. Pick a barangay, or try another landmark." };
        return { point: { barangay: r.barangay || null, street: "", lat: r.lat, lng: r.lng, name: r.name } };
      },
      error: function (msg) { hint(msg, true); },
      /** Fill from a saved point; older routes only have text. */
      set: function (pt, text) {
        el.landmark.value = ""; hint(""); kept = pt || null;
        var b = pt && pt.barangay, name = pt && pt.name;
        if (!pt && text) { var r = FDA.geo.resolve(text); if (r) { if (r.barangay && r.name === r.barangay) b = r.barangay; else name = r.name; } else name = text; }
        if (b && FDA.geo.districtOf(CITY, b) && !(pt && pt.name)) {
          el.district.value = FDA.geo.districtOf(CITY, b); fillBarangays(""); el.barangay.value = b;
          loadStreets(b, pt && pt.street);
        } else { el.district.value = ""; fillBarangays(""); el.barangay.value = ""; loadStreets(""); el.landmark.value = name || ""; }
      },
      clear: function () { this.set(null, ""); }
    };
  }

  /* Route drafts: the suggested route, adjusted on a map. One beside the desktop form, one in the phone editor. */
  var addDraftHost = document.createElement("div"); detail.insertAdjacentElement("beforebegin", addDraftHost);
  var addDraft = FDA.routeDraft.create(addDraftHost);
  var mDraftHost = document.createElement("div"); $(".route-points", editor).insertAdjacentElement("afterend", mDraftHost);
  var mDraft = FDA.routeDraft.create(mDraftHost, { collapseSaved: true });
  function sync(draft, s, e) { var a = s.value(), b = e.value(); draft.setEnds(a.point || null, b.point || null); }
  var addStart = Picker($('[data-point="start"]'), "Start point", function () { sync(addDraft, addStart, addEnd); });
  var addEnd = Picker($('[data-point="end"]'), "Destination", function () { sync(addDraft, addStart, addEnd); });
  var mStart = Picker($('[data-point="m-start"]'), "Start point", function () { sync(mDraft, mStart, mEnd); });
  var mEnd = Picker($('[data-point="m-end"]'), "Destination", function () { sync(mDraft, mStart, mEnd); });

  /* ---------- Real map of the route (Leaflet): the street path, its segments and the reports along it ---------- */
  var rmaps = [];
  $$(".route-map").forEach(function (el) {
    el.innerHTML = '<div class="route-map__canvas" role="img" aria-label="Map of the route along real streets, with nearby flood reports"></div>';
    el.insertAdjacentHTML("afterend", '<details class="route-segs"></details>');
    var rec = { el: el.firstChild, segs: el.nextElementSibling, map: null, layer: null, pending: null };
    rmaps.push(rec);
    FDA.mapkit.create(rec.el).then(function (m) {
      var L = window.L; rec.map = m; rec.layer = L.layerGroup().addTo(m);
      L.geoJSON(FDA.hazard.geojson(), { interactive: false, style: function (f) { var h = f.properties.hazard; return { color: "#fff", weight: 0.5, fillColor: FDA.mapkit.HAZARD[h], fillOpacity: h === "none" ? 0 : 0.28 }; } }).addTo(m);
      if (rec.pending) paintMap(rec, rec.pending.route, rec.pending.res);
    }).catch(function () { rec.el.innerHTML = '<p class="text-small text-muted" style="padding:16px">The map could not be loaded. The list below still works.</p>'; });
  });

  /** Worst status of the reports matched to each segment: ok, possible or warning. */
  function segmentStatus(route, res) {
    var out = (route.segments || []).map(function () { return "ok"; });
    res.possible.forEach(function (i) { if (out[i.seg] === "ok") out[i.seg] = "possible"; });
    res.warnings.forEach(function (i) { out[i.seg] = "warning"; });
    return out;
  }

  function paintSegments(rec, route, status) {
    if (!route.segments || !route.segments.length) { rec.segs.hidden = true; rec.segs.innerHTML = ""; return; }
    rec.segs.hidden = false;
    var legend = ["ok", "possible", "warning"].map(function (k) { return '<span class="route-segs__key"><i style="background:' + STATUS_COLORS[k] + '"></i>' + STATUS_WORDS[k] + "</span>"; }).join("");
    rec.segs.innerHTML = "<summary>Streets on this route (" + route.segments.length + ")</summary>" + '<p class="route-segs__legend">' + legend + "</p><ul>" +
      route.segments.map(function (s, i) {
        return '<li><i style="background:' + STATUS_COLORS[status[i]] + '"></i><span><strong>' + esc(s.street) + "</strong> · " + esc(s.barangay) + " · " + s.lengthM + " m</span><em>" + STATUS_WORDS[status[i]] + "</em></li>";
      }).join("") + "</ul>";
  }

  function paintMap(rec, route, res) {
    var L = window.L, pts = [], stops = FDA.routing.stopsOf(route);
    rec.layer.clearLayers();
    if (placed(route)) {
      var status = segmentStatus(route, res);
      L.polyline(route.geometry, { color: "#ffffff", weight: 10, opacity: 0.9, interactive: false }).addTo(rec.layer);
      route.segments.forEach(function (s, i) {
        L.polyline(s.lines, { color: STATUS_COLORS[status[i]], weight: 6, opacity: 0.95, lineCap: "round" })
          .bindTooltip(esc(s.street) + ", " + esc(s.barangay) + " · " + STATUS_WORDS[status[i]], { sticky: true }).addTo(rec.layer);
      });
      pts = pts.concat(route.geometry);
      paintSegments(rec, route, status);
    } else paintSegments(rec, route, []);   // no line is drawn for a route that is not placed on the streets
    var ends = placed(route) ? [{ lat: route.geometry[0][0], lng: route.geometry[0][1] }, { lat: route.geometry[route.geometry.length - 1][0], lng: route.geometry[route.geometry.length - 1][1] }] : stops;
    [[ends && ends[0], "Start: " + route.start, "A"], [ends && ends[1], "Destination: " + route.end, "B"]].forEach(function (x) {
      if (!x[0]) return; pts.push([x[0].lat, x[0].lng]);
      L.marker([x[0].lat, x[0].lng], { title: x[1], icon: L.divIcon({ className: "fda-pin fda-pin--route", html: "<span>" + x[2] + "</span>", iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(rec.layer);
    });
    res.items.forEach(function (i) {
      var r = i.report; if (r.lat == null || i.approximate) return; pts.push([r.lat, r.lng]);   // approximate reports have no true position to draw
      L.marker([r.lat, r.lng], { icon: FDA.mapkit.statusIcon(L, r.status, ""), opacity: i.recent ? 1 : 0.55, title: "#" + r.id + " " + FDA.agent.label(r.status) })
        .bindPopup("<strong>#" + r.id + " " + esc(FDA.agent.label(r.status)) + "</strong><br>" + esc(r.street) + "<br>" + i.where + " · " + esc(i.street + ", " + i.barangay) + " · " + FDA.ui.timeAgo(r.ts) + '<br><a href="report-details.html?id=' + r.id + '">Open report</a>').addTo(rec.layer);
    });
    rec.map.invalidateSize();
    if (pts.length) rec.map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
  }
  function drawMaps(route) {
    var res = check(route);
    rmaps.forEach(function (rec) { if (rec.map) paintMap(rec, route, res); else rec.pending = { route: route, res: res }; });
  }
  window.addEventListener("resize", function () { rmaps.forEach(function (r) { if (r.map) r.map.invalidateSize(); }); });

  /* ---------- Detail ---------- */
  function placeLine(i) {
    return esc(i.street + ", " + i.barangay);
  }

  function drawDetail() {
    var route = byId(selectedId);
    detail.hidden = !route;
    if (!route) return;
    var res = check(route), ps = planState[route.id];
    $("#route-title").textContent = route.name;
    $(".route-detail__head p").textContent = route.start + " → " + route.end + " · " + km(route);
    $(".route-detail__aside .badge--sample").textContent = "DEMO DATA";
    $(".route-detail__aside a").href = "schedules.html?route=" + route.id;

    /* Placing status (routes saved before street routing, or a failed lookup) */
    var plan = $(".route-plan");
    if (!plan) { plan = document.createElement("div"); plan.className = "route-plan callout callout--warning"; plan.setAttribute("role", "status"); $(".route-alert").insertAdjacentElement("beforebegin", plan); }
    plan.hidden = placed(route);
    if (!placed(route)) {
      plan.innerHTML = ps && ps.busy ? '<span class="pt__spinner" aria-hidden="true"></span> Finding the route…'
        : esc(ps && ps.error ? ps.error : "This route has not been placed on the streets yet, so no reports are matched to it.") + ' <button class="btn btn--outline btn--sm" type="button" data-plan>Find the route</button>';
    }

    var alert = $(".route-alert"), clear = $(".route-clear");
    var top = res.warnings[0];
    alert.hidden = !top;
    if (top) {
      $(".route-alert__title").textContent = res.warnings.length > 1 ? res.warnings.length + " flood warnings on your route" : "Flood warning on " + top.street + ", " + top.barangay;
      $(".route-alert__text").textContent = "#" + top.report.id + " · " + top.street + ", " + top.barangay + " · reported " + FDA.ui.timeAgo(top.report.ts) + " · " + top.report.still + " still-flooded confirmation" + (top.report.still === 1 ? "" : "s");
      $(".route-alert .btn").href = "report-details.html?id=" + top.report.id;
    }
    if (!clear) { clear = document.createElement("p"); clear.className = "callout callout--success route-clear"; alert.insertAdjacentElement("afterend", clear); }
    clear.hidden = !!top || res.level === "unplaced";
    clear.textContent = res.level === "possible" ? "No confirmed flood warning on this route, but there are possible floods nearby. Use caution."
      : "No recent flood reports along this route. Check local conditions before leaving.";

    $(".near-head h3").textContent = res.level === "unplaced" ? "Reports near this route" : "Reports near this route (" + res.items.length + ")";
    $(".near-head span").textContent = "Faded: may be outdated";
    $(".near-list").innerHTML = res.level === "unplaced" ? '<li class="text-small text-muted">Reports can only be matched once the route is placed on the streets.</li>'
      : res.items.length ? res.items.map(function (i) {
        return '<li><a class="near-item" style="' + (i.recent ? "" : "opacity:.55") + '" href="report-details.html?id=' + i.report.id + '"><span class="near-item__top">' + FDA.ui.badge(i.report.status) +
          '<span class="near-item__street">' + esc(i.report.street) + '</span></span><span class="near-item__meta">' + i.where + " · " + placeLine(i) + " · " + FDA.ui.timeAgo(i.report.ts) +
          (i.approximate ? " · location approximate" : "") + (i.recent ? "" : " · may be outdated") + "</span></a></li>";
      }).join("") : '<li class="text-small text-muted">No reports near this route.</li>';

    drawMaps(route);
    FDA.ui.bindSwitchOnce($(".alert-toggle .switch"), route.alert, function (v) { route.alert = v; FDA.store.save(); FDA.ui.toast(v ? "Route alerts on." : "Route alerts off."); drawEditor(); });
  }

  /* ---------- Placing routes that have no street geometry yet (saved before street routing) ---------- */
  function placeRoute(route) {
    planState[route.id] = { busy: true }; render();
    return FDA.routing.ensure(route).then(function () { delete planState[route.id]; }, function (err) { planState[route.id] = { error: err.message }; })
      .then(function () { render(); });
  }
  function placeAll() {
    var queue = mine().filter(function (r) { return !placed(r); });
    (function next() { var r = queue.shift(); if (r) placeRoute(r).then(next); })();   // one at a time, kind to the free routing server
  }
  detail.addEventListener("click", function (e) {
    if (e.target.closest("[data-plan]")) { var r = byId(selectedId); if (r) placeRoute(r); }
  });

  /* ---------- Phone editor ---------- */
  var mName = $("#m-route-name"), mSwitch = $(".route-editor .switch"), mNow = $(".route-now"), mSave = $(".route-editor .btn--primary"), mBack = $(".route-editor__back");
  var mSig = null, busy = false;
  function drawEditor() {
    var route = byId(selectedId), sig = route ? route.id + "|" + route.start + "|" + route.end : "new";
    if (sig !== mSig) {
      mSig = sig;
      mName.value = route ? route.name : "";
      if (route) { mStart.set(route.startPoint, route.start); mEnd.set(route.endPoint, route.end); mDraft.load(route); } else { mStart.clear(); mEnd.clear(); mDraft.reset(); }
    }
    FDA.ui.bindSwitchOnce(mSwitch, route ? route.alert : true, function (v) { if (route) { route.alert = v; FDA.store.save(); drawDetail(); } });
    var strong = mNow.querySelector("strong").outerHTML;
    if (route) {
      var res = check(route), top = res.warnings[0] || res.possible[0];
      mNow.innerHTML = strong + (res.level === "unplaced" ? "Route not placed on the streets yet"
        : top ? FDA.agent.label(top.report.status) + " on " + esc(top.street + ", " + top.barangay) + " · " + FDA.ui.timeAgo(top.report.ts) : "No recent flood reports on this route");
    } else mNow.innerHTML = strong + "Save the route to see its status";
    mBack.lastChild.textContent = " New route";
    if (!busy) mSave.textContent = route ? "Save route" : "Add route";
  }
  mBack.addEventListener("click", function (e) { e.preventDefault(); selectedId = null; render(); });

  /* ---------- Save / edit / delete ---------- */
  function setBusy(on) {
    busy = on;
    [$(".add-route .btn--primary"), mSave].forEach(function (b) {
      if (!b) return;
      if (on) { b.dataset.label = b.textContent; b.textContent = "Finding the route…"; } else if (b.dataset.label) { b.textContent = b.dataset.label; }
      b.disabled = on; b.setAttribute("aria-busy", String(on));
    });
  }

  /** ctx: {name, nameInput, start, end, existing}; start/end are pickers */
  function saveRoute(ctx) {
    if (busy) return;
    var name = ctx.name.trim(), bad = false, a = ctx.start.value(), b = ctx.end.value(), existing = ctx.existing;
    FDA.ui.fieldError(ctx.nameInput, ""); ctx.start.error(""); ctx.end.error("");
    if (!name) { bad = true; FDA.ui.fieldError(ctx.nameInput, "Give the route a name."); }
    if (a.error) { bad = true; ctx.start.error(a.error); }
    if (b.error) { bad = true; ctx.end.error(b.error); }
    if (bad) return;

    function commit(p) {
      if (!existing) { existing = { id: FDA.store.nextId("nextRoute"), userId: user.id, alert: true }; db.routes.push(existing); }
      existing.name = name; existing.start = label(a.point); existing.end = label(b.point);
      existing.startPoint = a.point; existing.endPoint = b.point;
      existing.geometry = p.geometry; existing.segments = p.segments; existing.distanceM = p.distanceM;
      var st = ctx.draft.state(); existing.vias = st.vias; existing.mode = st.mode;   // the points added on the map and snapped / freehand
      delete planState[existing.id];
      FDA.store.save(); selectedId = existing.id;
      resetAddForm();
      FDA.ui.toast("Route saved.", "success"); render();
    }
    setBusy(true);
    ctx.draft.setEnds(a.point, b.point);   // unchanged start and destination keep the points added on the map
    ctx.draft.ready().then(function (p) { setBusy(false); commit(p); }, function (err) {
      setBusy(false);
      ctx.end.error(err.message);
      FDA.ui.toast(err.message + " You can switch to freehand drawing on the map.", "error");   // nothing is saved, and no straight line is drawn for a street route
    });
  }

  /* Desktop form: add, or edit when a route's pencil is pressed */
  var addForm = $(".add-route"), addName = $("#route-name"), addTitle = $("#add-route-title"), addSave = $(".add-route .btn--primary");
  var addCancel = $('[data-act="cancel"]', addForm), addDelete = $('[data-act="delete"]', addForm);
  var editingId = null;
  function resetAddForm() {
    editingId = null; addName.value = ""; addStart.clear(); addEnd.clear(); addDraft.reset();
    addTitle.textContent = "Add a route"; addSave.textContent = "Save route"; addCancel.hidden = addDelete.hidden = true;
  }
  function startEdit(route) {
    editingId = route.id; addName.value = route.name;
    addStart.set(route.startPoint, route.start); addEnd.set(route.endPoint, route.end); addDraft.load(route);
    addTitle.textContent = "Edit route"; addSave.textContent = "Save changes"; addCancel.hidden = addDelete.hidden = false;
    addForm.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function submitAdd() { saveRoute({ name: addName.value, nameInput: addName, start: addStart, end: addEnd, draft: addDraft, existing: editingId ? byId(editingId) : null }); }
  addSave.addEventListener("click", submitAdd);
  addForm.addEventListener("submit", function (e) { e.preventDefault(); submitAdd(); });
  addCancel.addEventListener("click", resetAddForm);
  addDelete.addEventListener("click", function () {
    var route = byId(editingId); if (!route) return;
    FDA.ui.dialog({ title: "Delete “" + route.name + "”?", text: "Its travel schedules will be deleted too.", confirm: "Delete", danger: true }).then(function (ok) {
      if (!ok) return;
      db.routes = db.routes.filter(function (r) { return r.id !== route.id; });
      db.schedules = db.schedules.filter(function (s) { return s.routeId !== route.id; });
      FDA.store.save(); if (selectedId === route.id) selectedId = null; resetAddForm(); render(); FDA.ui.toast("Route deleted.");
    });
  });

  /* Phone form */
  mSave.addEventListener("click", function () { saveRoute({ name: mName.value, nameInput: mName, start: mStart, end: mEnd, draft: mDraft, existing: byId(selectedId) }); });

  listUl.addEventListener("click", function (e) {
    var b = e.target.closest(".route-card__edit"); if (!b) return;
    var route = byId(+b.dataset.id); if (!route) return;
    selectedId = route.id; render(); startEdit(route);
  });

  function render() {
    if (!byId(selectedId)) selectedId = mine()[0] ? mine()[0].id : null;
    drawList(); drawDetail(); drawEditor();
    history.replaceState(null, "", selectedId ? "routes.html?id=" + selectedId : "routes.html");
  }
  render();
  placeAll();
})();
