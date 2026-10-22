/**
 * Route draft: suggest a route, then let the person correct it on a map.
 *
 *   var d = FDA.routeDraft.create(hostElement, { collapsed: false });
 *   d.setEnds(startPoint, endPoint)   shows the suggested street route between two {lat,lng} points (null hides the map)
 *   d.load(route)                     shows a saved route (its geometry, extra points and mode) for editing
 *   d.ready()                         Promise<{geometry, segments, distanceM}> for the line as it is now (rejects with a readable message)
 *   d.state()                         {vias, mode}   the points the person added and "snap" or "free"
 *   d.addPoint(lat, lng)              what a tap on the map does
 *   d.reset()                         clears and hides
 *
 * How it works
 *   - The suggested route comes from FDA.routing.plan (OSRM, snapped to streets).
 *   - Tapping the map adds a point on the road the person really takes; the route is asked for again through
 *     every point, so it still follows streets. Drag a numbered point to move it, tap it to remove it.
 *   - "Draw freehand" joins the taps with straight lines instead (FDA.routing.freehand), so it also works when
 *     the routing service is down. Tap often and zoom in: a hand-drawn line is only as exact as the taps.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var esc = function (s) { return FDA.ui.esc(s); };
  var MAX_POINTS = 15, WAIT_MS = 450;

  function same(p, q) { return p && q && FDA.geo.distance(p, q) < 5; }

  /** Index of the line vertex closest to a point. */
  function nearestIndex(line, p) {
    var k = Math.cos(p.lat * Math.PI / 180), best = 0, bd = Infinity;
    for (var i = 0; i < line.length; i++) {
      var dx = (line[i][1] - p.lng) * k, dy = line[i][0] - p.lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function create(host, opts) {
    opts = opts || {};
    host.innerHTML = '<details class="route-draft"' + (opts.collapsed ? "" : " open") + " hidden>" +
      "<summary>Adjust the route on the map <span class=\"route-draft__badge\">not saved yet</span></summary>" +
      '<p class="route-draft__status" role="status"></p>' +
      '<div class="route-draft__map" role="application" aria-label="Map to adjust the route"></div>' +
      '<div class="route-draft__tools">' +
      '<button class="btn btn--outline btn--sm" type="button" data-a="undo">Undo last point</button>' +
      '<button class="btn btn--outline btn--sm" type="button" data-a="reset">Back to suggested route</button>' +
      '<label class="route-draft__free"><input type="checkbox" data-a="free"> Draw freehand (no street snapping)</label></div>' +
      '<p class="route-draft__hint">Tap the map on the road you really take to add a point. Drag a numbered point to move it, tap it to remove it. In freehand mode, zoom in and tap often.</p></details>';
    var root = host.firstChild, statusEl = root.querySelector(".route-draft__status"), mapEl = root.querySelector(".route-draft__map");
    var undoBtn = root.querySelector('[data-a="undo"]'), resetBtn = root.querySelector('[data-a="reset"]'), freeBox = root.querySelector('[data-a="free"]');

    var a = null, b = null, vias = [], mode = "snap", result = null, err = "", busy = false;
    var token = 0, timer = null, current = null, fitNext = true;
    var map = null, layer = null, mapPending = false;

    function stops() { return [a].concat(vias, [b]); }

    /* ---------- Map ---------- */
    function ensureMap() {
      if (map || mapPending) return;
      mapPending = true;
      FDA.mapkit.create(mapEl).then(function (m) {
        map = m; layer = window.L.layerGroup().addTo(m);
        m.on("click", function (e) { addPoint(e.latlng.lat, e.latlng.lng); });
        m.invalidateSize(); draw(); fit();
      }).catch(function () { mapEl.innerHTML = '<p class="text-small text-muted" style="padding:16px">The map could not be loaded. You can still save the suggested route.</p>'; });
    }
    root.addEventListener("toggle", function () { if (map && root.open) { map.invalidateSize(); fit(); } });

    function pin(cls, text) { return window.L.divIcon({ className: "fda-pin " + cls, html: "<span>" + text + "</span>", iconSize: [26, 26], iconAnchor: [13, 13] }); }

    function fit() {
      if (!map || !a || !b || !root.open) return;
      var pts = result ? result.geometry : stops().map(function (p) { return [p.lat, p.lng]; });
      map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
    }

    function draw() {
      var s;
      if (err) s = esc(err) + (mode === "snap" ? ' <button class="btn btn--outline btn--sm" type="button" data-a="free-on">Draw freehand instead</button>' : "");
      else if (busy) s = '<span class="pt__spinner" aria-hidden="true"></span> Finding the route…';
      else if (result) {
        s = "About " + (result.distanceM / 1000).toFixed(1) + " km · " + (mode === "free" ? "hand-drawn line" : result.segments.length + " street stretch" + (result.segments.length === 1 ? "" : "es")) +
          " · " + (vias.length ? vias.length + " point" + (vias.length === 1 ? "" : "s") + " added" : "suggested route");
      } else s = "Pick a start point and a destination to see the route.";
      statusEl.innerHTML = s;
      undoBtn.disabled = !vias.length; resetBtn.disabled = !vias.length && mode === "snap";
      freeBox.checked = mode === "free";
      if (!map) return;
      layer.clearLayers();
      var L = window.L;
      if (result) {
        L.polyline(result.geometry, { color: "#ffffff", weight: 9, opacity: 0.9, interactive: false }).addTo(layer);
        L.polyline(result.geometry, { color: "#0b5d98", weight: 5, opacity: busy ? 0.4 : 0.95, interactive: false, dashArray: mode === "free" ? "2 8" : null, lineCap: "round" }).addTo(layer);
      }
      if (a && b) {
        L.marker([a.lat, a.lng], { icon: pin("fda-pin--route", "A"), title: "Start", interactive: false }).addTo(layer);
        L.marker([b.lat, b.lng], { icon: pin("fda-pin--route", "B"), title: "Destination", interactive: false }).addTo(layer);
      }
      vias.forEach(function (v, i) {
        var m = L.marker([v.lat, v.lng], { icon: pin("fda-pin--via", i + 1), draggable: true, title: "Point " + (i + 1) + ": drag to move, tap to remove" }).addTo(layer);
        m.on("dragend", function () { var ll = m.getLatLng(); vias[i] = { lat: ll.lat, lng: ll.lng }; schedule(); });
        m.on("click", function () { vias.splice(i, 1); schedule(); });
      });
    }

    /* ---------- Asking for the route ---------- */
    function plan() {
      timer = null;
      if (!a || !b) { busy = false; draw(); return; }
      var t = ++token;
      busy = true; err = ""; draw();
      var p = mode === "free" ? FDA.routing.freehand(stops()) : FDA.routing.plan(stops());
      current = p.then(function (res) {
        if (t !== token) return current;   // a newer request replaced this one
        result = res; busy = false; err = ""; draw();
        if (fitNext) { fitNext = false; fit(); }
        if (opts.onChange) opts.onChange();
        return res;
      }, function (e) {
        if (t !== token) return current;
        result = null; busy = false; err = e.message; draw();
        throw e;
      });
      current.catch(function () { /* shown in the status line; ready() hands it to the caller */ });
    }
    function schedule() {
      clearTimeout(timer); busy = true; err = ""; draw();
      timer = setTimeout(plan, WAIT_MS);
    }

    function addPoint(lat, lng) {
      if (!a || !b) return;
      if (vias.length >= MAX_POINTS) { FDA.ui.toast("You can add up to " + MAX_POINTS + " points.", "error"); return; }
      var click = { lat: lat, lng: lng }, line = result ? result.geometry : [[a.lat, a.lng], [b.lat, b.lng]];
      var gi = nearestIndex(line, click), all = stops(), pos = 1;
      for (var i = 1; i < all.length - 1; i++) if (nearestIndex(line, all[i]) <= gi) pos = i + 1;   // keep the points in the order they are travelled
      vias.splice(pos - 1, 0, click);
      schedule();
    }

    /* ---------- Buttons ---------- */
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-a]"); if (!btn) return;
      if (btn.dataset.a === "undo") { vias.pop(); schedule(); }
      else if (btn.dataset.a === "reset") { vias = []; mode = "snap"; fitNext = true; schedule(); }
      else if (btn.dataset.a === "free-on") { mode = "free"; schedule(); }
    });
    freeBox.addEventListener("change", function () { mode = freeBox.checked ? "free" : "snap"; schedule(); });

    function show(open) {
      root.hidden = false;
      if (open !== undefined) root.open = open;
      ensureMap();
    }

    var api = {
      setEnds: function (na, nb) {
        if (!na || !nb) { a = b = null; vias = []; result = null; err = ""; busy = false; clearTimeout(timer); timer = null; root.hidden = true; return; }
        var unchanged = same(a, na) && same(b, nb);
        a = na; b = nb; show(!opts.collapsed);
        if (!unchanged) { vias = []; result = null; fitNext = true; schedule(); }
      },
      load: function (route) {
        var stopsOf = FDA.routing.stopsOf(route);
        if (!stopsOf) { this.reset(); return; }
        a = stopsOf[0]; b = stopsOf[1]; vias = (route.vias || []).slice(); mode = route.mode || "snap"; err = ""; busy = false; fitNext = true;
        clearTimeout(timer); timer = null;
        result = route.geometry && route.geometry.length > 1 && route.segments && route.segments.length ? { geometry: route.geometry, segments: route.segments, distanceM: route.distanceM || 0 } : null;
        show(!opts.collapsed && !opts.collapseSaved); draw(); fit();
        if (!result) schedule();
      },
      ready: function () {
        if (!a || !b) return Promise.reject(new Error("Pick a start point and a destination first."));
        if (timer) { clearTimeout(timer); plan(); }
        if (busy) return current;
        if (result) return Promise.resolve(result);
        if (err) return Promise.reject(new Error(err));
        plan(); return current;
      },
      state: function () { return { vias: vias.slice(), mode: mode }; },
      addPoint: addPoint,
      reset: function () { a = b = null; vias = []; mode = "snap"; result = null; err = ""; busy = false; clearTimeout(timer); timer = null; root.hidden = true; }
    };
    FDA.routeDraft.all.push(api);   // lets a test or the console reach the drafts
    return api;
  }

  FDA.routeDraft = { create: create, all: [] };
})();
