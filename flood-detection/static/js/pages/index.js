/** Home page: live warning count and the signed-in user's route status */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$;
  var db = FDA.store.db(), now = Date.now(), user = FDA.auth.current();

  /* Banner */
  var recent = db.reports.filter(function (r) { return !r.removed && r.status === "flood-warning" && now - r.ts < 24 * 3600000; });
  var banner = $(".alert-banner__inner > span");
  if (banner) {
    var note = $(".alert-banner__note", banner);
    banner.firstChild.textContent = recent.length
      ? recent.length + " flood warning" + (recent.length > 1 ? "s" : "") + " reported in Metro Manila in the last 24 hours "
      : "No flood warnings reported in Metro Manila in the last 24 hours ";
    if (note) note.textContent = "· demo data";
  }

  /* Saved-route card */
  var card = $(".route-card");
  if (!card) return;
  var title = $(".route-card__title", card), status = $(".route-card__status", card), link = $(".link-button", card);
  function setStatus(text) {
    var icon = status.querySelector("svg");
    status.textContent = "";
    if (icon) status.appendChild(icon);
    status.appendChild(document.createTextNode(" " + text));
  }

  var routes = user ? db.routes.filter(function (r) { return r.userId === user.id; }) : [];
  if (!user) {
    title.textContent = "Saved routes";
    setStatus("Sign in to save a route and get flood alerts.");
    link.textContent = "Sign in →"; link.href = "auth/login.html";
  } else if (!routes.length) {
    title.textContent = "My routes";
    setStatus("You have no saved routes yet.");
    link.textContent = "Add one →"; link.href = "routes.html";
  } else {
    var route = routes[0], res = FDA.agent.routeCheck(route, db.reports);
    var top = res.warnings[0] || res.possible[0];
    title.textContent = "My route · " + route.name;
    setStatus(top
      ? res.warnings.length + " flood warning" + (res.warnings.length === 1 ? "" : "s") + " on your route · " + FDA.ui.timeAgo(top.report.ts)
      : "No recent flood reports on your route");
    link.href = "routes.html?id=" + route.id;
  }
})();
