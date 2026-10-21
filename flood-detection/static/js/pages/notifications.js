/** Notifications: list, filters, mark as read and settings */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var user = FDA.auth.current();

  var box = $(".notice-list"), filters = $$(".filter-chip");
  var ICON = { route: ["alert", FDA.ui.icon["flood-warning"]], confirm: ["confirmed", $(".notice__icon--confirmed svg").innerHTML], comment: ["comment", FDA.ui.icon.comment], dup: ["duplicate", FDA.ui.icon.duplicate], schedule: ["schedule", FDA.ui.icon.schedule], clear: ["confirmed", $(".notice__icon--confirmed svg").innerHTML] };
  var KINDS = ["all", "route", "schedule", "report"];
  var LABEL = { route: "Route alert", schedule: "Travel schedule", report: "My report" };
  var active = "all";

  function iconFor(n) {
    var key = n.kind === "route" ? "route" : n.kind === "schedule" ? (/^clear/.test(n.key) || /^No recent/.test(n.title) ? "clear" : "schedule") : /^confirm/.test(n.key) ? "confirm" : /^comment/.test(n.key) ? "comment" : /^dup/.test(n.key) ? "dup" : "comment";
    return ICON[key];
  }

  function item(n) {
    var ic = iconFor(n);
    return '<li><article class="notice' + (n.read ? "" : " notice--unread") + '" data-id="' + n.id + '"><span class="notice__icon notice__icon--' + ic[0] + '"><svg class="icon icon--md" viewBox="0 0 24 24" aria-hidden="true">' + ic[1] + "</svg></span>" +
      '<div class="notice__body"><div class="notice__top"><span class="notice__kind">' + LABEL[n.kind] + '</span><span class="notice__time">' + FDA.ui.clock(n.ts) + (n.read ? "" : ' <span class="notice__dot" aria-hidden="true"></span><span class="visually-hidden">Unread</span>') + "</span></div>" +
      '<h2 class="notice__title">' + esc(n.title) + '</h2><p class="notice__text">' + esc(n.text) + "</p>" +
      (n.href ? '<a class="link notice__action" href="' + esc(n.href) + '" data-read="' + n.id + '">' + esc(n.cta || "Open →") + "</a>" : "") + "</div></article></li>";
  }

  function render() {
    var all = FDA.notify.forUser(user.id);
    var counts = { all: all.length };
    KINDS.slice(1).forEach(function (k) { counts[k] = all.filter(function (n) { return n.kind === k; }).length; });
    var names = { all: "All", route: "Route alerts", schedule: "Travel schedule", report: "My reports" };
    filters.forEach(function (b, i) { b.textContent = names[KINDS[i]] + " · " + counts[KINDS[i]]; b.setAttribute("aria-pressed", String(KINDS[i] === active)); });

    var rows = active === "all" ? all : all.filter(function (n) { return n.kind === active; });
    var groups = {};
    rows.forEach(function (n) { (groups[FDA.ui.dayLabel(n.ts)] = groups[FDA.ui.dayLabel(n.ts)] || []).push(n); });
    var html = Object.keys(groups).map(function (g, i) {
      return '<p class="notice-group">' + g + (i === 0 ? ' <span class="badge badge--sample">DEMO DATA</span>' : "") + "</p><ul>" + groups[g].map(item).join("") + "</ul>";
    }).join("");
    box.innerHTML = html || '<p class="notice-group">Nothing here yet</p><p class="text-small text-muted" style="padding:8px 20px 20px">' +
      (active === "route" ? "Save a route to get alerts when a flood report appears along it." : "New notifications will show up here.") + "</p>";
    FDA.layout.refresh();
  }

  filters.forEach(function (b, i) { b.addEventListener("click", function () { active = KINDS[i]; render(); }); });
  var markAll = $(".notices-head__desktop");
  markAll.addEventListener("click", function () { FDA.notify.markAllRead(user.id); render(); });

  // Opening a notification marks it as read
  box.addEventListener("click", function (e) {
    var art = e.target.closest(".notice"); if (!art) return;
    var n = FDA.store.db().notifications.filter(function (x) { return x.id === +art.dataset.id; })[0];
    if (n && !n.read) { n.read = true; FDA.store.save(); if (!e.target.closest("a")) render(); }
  });

  /* Settings */
  var map = { "set-route": "route", "set-schedule": "schedule", "set-reports": "reports", "set-clear": "clear" };
  var settings = FDA.notify.settings(user.id);
  $$(".settings-list .switch").forEach(function (sw) {
    var key = map[sw.getAttribute("aria-labelledby")];
    FDA.ui.bindSwitch(sw, settings[key], function (v) { settings[key] = v; FDA.store.save(); FDA.ui.toast(v ? "Turned on." : "Turned off."); });
  });

  var empty = $(".empty-card"); if (empty) empty.hidden = FDA.store.db().routes.some(function (r) { return r.userId === user.id; });
  render();
})();
