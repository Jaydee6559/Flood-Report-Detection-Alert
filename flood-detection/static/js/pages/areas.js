/**
 * Flood areas: index of the 142 barangays, and a profile for one (?b=Culiat).
 * Shows hazard (sample), rain now, and the agent's Rule 2 area risk with its reasons.
 */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, esc = FDA.ui.esc;
  var CITY = "Quezon City", LVL = { yellow: "Yellow", orange: "Orange", red: "Red" };
  var RR = { high: 3, elevated: 2, low: 1 }, HR = { high: 3, medium: 2, low: 1, none: 0 };
  var hours = 0, current = null, mini = null, user = FDA.auth.current();

  var names = FDA.hazard.barangays().map(function (b) { return b.name; }).sort(function (a, b) { return a.localeCompare(b, "en"); });
  $("#area-names").innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
  FDA.geo.districts(CITY).forEach(function (d) { $("#area-district").insertAdjacentHTML("beforeend", '<option value="' + d.id + '">District ' + d.id + "</option>"); });

  function rainText(a) { return a.rain ? LVL[a.rain] + " rain · " + a.mm + " mm/h" : "No rain level · " + a.mm + " mm/h"; }

  /* ----- Index ----- */
  function drawIndex() {
    var q = $("#area-search").value.trim().toLowerCase(), d = $("#area-district").value, sort = $("#area-sort").value;
    var all = FDA.areas.compute(0).byName, rows = Object.keys(all).map(function (n) { return all[n]; }).filter(function (r) {
      return (!d || String(r.district) === d) && (!q || r.name.toLowerCase().indexOf(q) >= 0);
    });
    rows.sort(function (x, y) {
      if (sort === "name") return x.name.localeCompare(y.name, "en");
      if (sort === "hazard") return HR[y.hazard] - HR[x.hazard] || x.name.localeCompare(y.name, "en");
      return RR[y.level] - RR[x.level] || HR[y.hazard] - HR[x.hazard] || x.name.localeCompare(y.name, "en");
    });
    $("#area-count").textContent = rows.length + " of 142 barangays";
    $("#area-grid").innerHTML = rows.length ? rows.map(function (r) {
      return '<li><a class="area-tile" href="areas.html?b=' + encodeURIComponent(r.name) + '"><span class="risk-bar risk-bar--' + r.level + '"></span><span><strong>' + esc(r.name) + "</strong>" +
        "<small>District " + r.district + " · " + esc(FDA.hazard.label(r.hazard).toLowerCase()) + "</small><small>" + esc(rainText(r)) + " · " + r.spots + " spot" + (r.spots === 1 ? "" : "s") + "</small>" +
        '<small><strong class="text-risk-' + r.level + '">' + esc(FDA.agent.areaLabel(r.level)) + " risk</strong></small></span></a></li>";
    }).join("") : '<li class="area-empty">No barangay matches. Try another name.</li>';
  }
  ["input", "change"].forEach(function (ev) { $("#area-search").addEventListener(ev, drawIndex); });
  $("#area-district").addEventListener("change", drawIndex);
  $("#area-sort").addEventListener("change", drawIndex);

  /* ----- Profile ----- */
  function go(name) { if (FDA.hazard.get(name)) location.href = "areas.html?b=" + encodeURIComponent(name); }

  function drawProfile() {
    var a = FDA.areas.get(current, hours), b = FDA.hazard.get(current);
    $("#p-eyebrow").textContent = "Barangay · District " + b.district + (b.approx ? " · approximate area" : "");
    $("#p-title").textContent = current;
    document.title = current + " · Flood areas · Flood Detection & Alert";
    $("#p-hazard").textContent = FDA.hazard.label(a.hazard);
    $("#p-hazard-note").textContent = "Sample hazard level until the UP NOAH layer is added.";
    $("#p-rain").textContent = rainText(a);
    $("#p-rain-note").textContent = "District " + b.district + " rain, " + (hours ? "+" + hours + " h" : "now") + ". Estimate from Open-Meteo using PAGASA levels, not an official warning.";
    $("#p-risk").innerHTML = '<span class="text-risk-' + a.level + '">' + esc(FDA.agent.areaLabel(a.level)) + " risk</span>";
    $("#p-risk-note").textContent = a.text;
    $("#p-why-title").textContent = "Why the risk is " + FDA.agent.areaLabel(a.level).toLowerCase();
    $("#p-why").innerHTML = a.reasons.map(function (r) {
      return '<li class="' + (r.on ? "is-on" : "is-off") + '"><span>' + FDA.ui.svg(r.on ? "possible-flood" : "no-flood") + '</span><span><span class="why-list__title">' + esc(r.title) + '</span><span class="why-list__detail">' + esc(r.detail) + '</span></span><span class="why-list__tag">' + esc(r.tag) + "</span></li>";
    }).join("");
    $$h().forEach(function (btn) { btn.setAttribute("aria-pressed", String(+btn.dataset.h === hours)); });
  }
  function $$h() { return Array.prototype.slice.call(document.querySelectorAll("#p-hours button")); }

  function drawSpots() {
    var spots = FDA.hazard.spotsIn(current);
    $("#p-spots tbody").innerHTML = spots.map(function (s) {
      return "<tr><td>" + esc(s.corner) + "</td><td>" + s.times + "</td><td>" + esc(FDA.hazard.depth(s.depth).label) + "</td><td>" + esc(FDA.hazard.pass(s.pass)) + "</td><td>" + esc(s.last) + "</td></tr>";
    }).join("");
    $("#p-spots").hidden = !spots.length; $("#p-spots-empty").hidden = !!spots.length;
  }

  function drawMini() {
    FDA.mapkit.create($("#p-minimap"), { center: [FDA.hazard.get(current).lat, FDA.hazard.get(current).lng], zoom: 15 }).then(function (m) {
      var L = window.L, b = FDA.hazard.get(current);
      var poly = L.geoJSON(b.feature, { style: { color: "#0b5d98", weight: 3, fillColor: FDA.mapkit.HAZARD[b.hazard], fillOpacity: 0.45 } }).addTo(m);
      m.fitBounds(poly.getBounds(), { padding: [20, 20] });
      FDA.hazard.spotsIn(current).forEach(function (s) { L.marker([s.lat, s.lng], { icon: FDA.mapkit.dropIcon(L, s.times), title: s.corner }).addTo(m).bindPopup(esc(s.corner)); });
    }).catch(function () { $("#p-minimap").innerHTML = '<p class="area-empty">The map could not be loaded. Check your internet connection.</p>'; });
  }

  function drawWatch() {
    var btn = $("#p-watch");
    if (!user) { btn.textContent = "Log in to get alerts"; btn.onclick = function () { location.href = "auth/login.html"; }; return; }
    var home = FDA.areas.watched(user.id).indexOf(current) >= 0 && !FDA.areas.isWatching(user.id, current);
    var on = FDA.areas.isWatching(user.id, current) || home;
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = home ? "Your home barangay" : on ? "Alerts on" : "Alert me";
    btn.disabled = home;
    btn.onclick = function () {
      var now = !FDA.areas.isWatching(user.id, current);
      FDA.areas.setWatching(user.id, current, now); drawWatch();
      FDA.ui.toast(now ? "You will be alerted if " + current + " becomes high risk." : "Alerts off for " + current + ".");
    };
  }

  function openProfile(name) {
    current = name;
    $("#area-index").hidden = true; $("#area-profile").hidden = false;
    $("#p-map").href = "map.html?b=" + encodeURIComponent(name);
    $("#p-report").href = "report.html?barangay=" + encodeURIComponent(name);
    $("#p-hours").innerHTML = [0, 1, 2, 3].map(function (h) { return '<button type="button" data-h="' + h + '" aria-pressed="' + (h === 0) + '">' + (h ? "+" + h + " h" : "Now") + "</button>"; }).join("");
    $("#p-hours").addEventListener("click", function (e) { var t = e.target.closest("[data-h]"); if (t) { hours = +t.dataset.h; drawProfile(); } });
    drawProfile(); drawSpots(); drawWatch(); drawMini();
  }
  $("#p-find").addEventListener("change", function () { go(this.value.trim()); });

  var want = FDA.ui.param("b");
  if (want && FDA.hazard.get(want)) openProfile(want); else drawIndex();
  window.addEventListener("fda:rain", function () { if (current) drawProfile(); else drawIndex(); });
  FDA.rain.load();
})();
