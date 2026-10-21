/** Travel schedules: set days and a departure time; the agent checks the route before you leave */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc, S = FDA.scheduler;
  var db = FDA.store.db(), user = FDA.auth.current();

  var listUl = $(".schedule-list"), form = $(".schedule-form");
  var routeSel = $("#sched-route"), timeIn = $("#sched-time"), beforeSel = $("#sched-before"), chips = $$(".day-chip");
  var saveBtn = $(".schedule-form__buttons .btn--primary"), cancelBtn = $(".schedule-form__buttons .btn--ghost");
  var iconClock = $(".schedule-item__icon svg").outerHTML, iconStatus = $(".schedule-item__status svg").outerHTML;
  var warnHead = $(".sched-alert__head svg").outerHTML, clearIcon = $(".sched-alert--clear > svg").outerHTML;
  var examples = $(".sched-alert--warning").parentNode;
  var editingId = null;

  var BEFORE = { "15 min": 15, "30 min": 30, "45 min": 45, "1 hour": 60 };
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // chips go Mon … Sun

  function mine() { return db.schedules.filter(function (s) { return s.userId === user.id; }); }
  function routeOf(s) { return db.routes.filter(function (r) { return r.id === s.routeId; })[0]; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }

  /* ---------- Form ---------- */
  function fillRoutes(selected) {
    var routes = db.routes.filter(function (r) { return r.userId === user.id; });
    routeSel.innerHTML = "";
    routes.forEach(function (r) { routeSel.appendChild(new Option(r.name, r.id)); });
    if (selected) routeSel.value = selected;
    if (!routes.length) { routeSel.appendChild(new Option("No saved routes yet", "")); }
  }

  function readForm() {
    return {
      routeId: +routeSel.value || null,
      days: chips.map(function (c, i) { return c.getAttribute("aria-pressed") === "true" ? DAY_ORDER[i] : null; }).filter(function (d) { return d !== null; }),
      time: timeIn.value, before: BEFORE[beforeSel.value] || 30
    };
  }

  function summary() {
    var v = readForm(), route = db.routes.filter(function (r) { return r.id === v.routeId; })[0], el = $(".schedule-summary p:last-child");
    if (!route || !v.days.length || !v.time) { el.textContent = "Choose a route, at least one day and a departure time."; return; }
    var chk = S.checkTimeText({ time: v.time, before: v.before });
    el.innerHTML = "Every <strong>" + esc(S.describeDays(v.days).toLowerCase()) + "</strong> at <strong>" + chk + "</strong>, check recent reports along <strong>" + esc(route.name) + "</strong> and alert me in the app if one is found.";
  }

  function loadForm(s) {
    editingId = s ? s.id : null;
    fillRoutes(s ? s.routeId : (+FDA.ui.param("route") || null));
    chips.forEach(function (c, i) { c.setAttribute("aria-pressed", String(s ? s.days.indexOf(DAY_ORDER[i]) >= 0 : i < 5)); });
    timeIn.value = s ? s.time : "06:45";
    beforeSel.value = Object.keys(BEFORE).filter(function (k) { return BEFORE[k] === (s ? s.before : 30); })[0] || "30 min";
    $("#schedule-form-title").textContent = s ? "Edit travel schedule" : "Set a travel schedule";
    saveBtn.textContent = s ? "Save changes" : "Save schedule";
    var del = $(".schedule-form__delete");
    if (s && !del) { del = document.createElement("button"); del.type = "button"; del.className = "btn btn--ghost schedule-form__delete"; del.textContent = "Delete"; cancelBtn.insertAdjacentElement("afterend", del); del.addEventListener("click", removeSchedule); }
    if (!s && del) del.remove();
    summary();
  }

  chips.forEach(function (c) { c.addEventListener("click", function () { c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); summary(); }); });
  [routeSel, timeIn, beforeSel].forEach(function (el) { el.addEventListener("change", summary); });
  cancelBtn.addEventListener("click", function () { loadForm(null); });
  form.addEventListener("submit", function (e) { e.preventDefault(); save(); });
  saveBtn.addEventListener("click", save);

  function save() {
    var v = readForm();
    FDA.ui.fieldError(routeSel, ""); FDA.ui.fieldError(timeIn, "");
    if (!v.routeId) return FDA.ui.fieldError(routeSel, "Save a route first. Travel schedules check a saved route.");
    if (!v.days.length) return FDA.ui.toast("Pick at least one day.", "error");
    if (!v.time) return FDA.ui.fieldError(timeIn, "Set the usual departure time.");
    var s = editingId ? db.schedules.filter(function (x) { return x.id === editingId; })[0] : null;
    if (s) { s.routeId = v.routeId; s.days = v.days; s.time = v.time; s.before = v.before; s.lastCheck = null; }
    else { s = { id: FDA.store.nextId("nextSchedule"), userId: user.id, routeId: v.routeId, days: v.days, time: v.time, before: v.before, enabled: true, lastCheck: null }; db.schedules.push(s); }
    FDA.store.save();
    var route = routeOf(s);
    FDA.notify.push(user.id, { kind: "schedule", key: "set:" + s.id, title: "Travel check for " + S.clockText(s.time) + " is set", text: S.describeDays(s.days) + " · " + route.name + " · check at " + S.checkTimeText(s), href: "schedules.html", cta: "Edit schedule →" });
    FDA.ui.toast("Schedule saved.", "success"); FDA.layout.refresh();
    loadForm(null); render();
  }

  function removeSchedule() {
    FDA.ui.dialog({ title: "Delete this schedule?", text: "The agent will stop checking this route before you leave.", confirm: "Delete", danger: true }).then(function (ok) {
      if (!ok) return;
      db.schedules = db.schedules.filter(function (s) { return s.id !== editingId; });
      FDA.store.save(); loadForm(null); render(); FDA.ui.toast("Schedule deleted.");
    });
  }

  /* ---------- Lists ---------- */
  function drawList() {
    var rows = mine();
    listUl.innerHTML = rows.length ? rows.map(function (s) {
      var r = routeOf(s); if (!r) return "";
      var done = s.lastCheck === today();
      return '<li class="schedule-item' + (s.enabled ? "" : " schedule-item--paused") + '" data-id="' + s.id + '" tabindex="0" role="button" aria-label="Edit schedule ' + esc(r.name) + '" style="cursor:pointer">' +
        '<span class="schedule-item__icon">' + iconClock + '</span><div class="schedule-item__text"><p class="schedule-item__title">' + esc(r.name) + '</p><p class="schedule-item__meta">' + S.describeDays(s.days) + " · leave " + S.clockText(s.time) + "</p></div>" +
        '<span class="schedule-item__status">' + iconStatus + (s.enabled ? (done ? "Checked " : "Check at ") + S.checkTimeText(s) : "Paused") + "</span></li>";
    }).join("") : '<li class="schedule-item"><div class="schedule-item__text"><p class="schedule-item__title">No travel schedules yet</p><p class="schedule-item__meta">Set one on the right. You need a saved route first.</p></div></li>';

    $(".my-schedules__list").innerHTML = rows.map(function (s) {
      var r = routeOf(s); if (!r) return "";
      return '<li class="my-schedule">' + iconClock + '<div class="my-schedule__text"><p class="my-schedule__title" id="ms-' + s.id + '">' + esc(r.name) + '</p><p class="my-schedule__meta">' + S.describeDays(s.days) + " · leave " + S.clockText(s.time) +
        '</p></div><button class="switch" type="button" role="switch" aria-checked="' + s.enabled + '" aria-labelledby="ms-' + s.id + '" data-id="' + s.id + '"></button></li>';
    }).join("");
  }
  function edit(e) {
    var li = e.target.closest(".schedule-item[data-id]");
    if (!li || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    loadForm(db.schedules.filter(function (s) { return s.id === +li.dataset.id; })[0]);
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  listUl.addEventListener("click", edit); listUl.addEventListener("keydown", edit);
  $(".my-schedules__list").addEventListener("click", function (e) {
    var sw = e.target.closest(".switch"); if (!sw) return;
    var s = db.schedules.filter(function (x) { return x.id === +sw.dataset.id; })[0];
    s.enabled = sw.getAttribute("aria-checked") !== "true"; sw.setAttribute("aria-checked", String(s.enabled));
    FDA.store.save(); drawList(); drawChecks();
  });
  [$(".schedules-head .btn"), $(".travel-mobile > .btn")].forEach(function (b) {
    b.addEventListener("click", function () { loadForm(null); form.scrollIntoView({ behavior: "smooth", block: "center" }); routeSel.focus(); });
  });

  /* ---------- Latest checks (live, from the agent) ---------- */
  function drawChecks() {
    var on = mine().filter(function (s) { return s.enabled && routeOf(s); });
    examples.querySelectorAll(".sched-alert").forEach(function (n) { n.remove(); });
    $(".eyebrow-row .eyebrow").textContent = "Latest route checks";
    var tag = $(".eyebrow-row .badge--sample"); tag.textContent = "LIVE · DEMO REPORTS";
    var html = on.map(function (s) {
      var r = routeOf(s), res = FDA.agent.routeCheck(r, db.reports), top = res.warnings[0] || res.possible[0];
      var dep = S.clockText(s.time);
      if (top) {
        var word = res.warnings.length ? "flood warning" : "possible flood";
        return '<section class="card sched-alert sched-alert--warning"><div class="sched-alert__head">' + warnHead + " Before your " + dep + " trip · " + esc(r.name) + '<span class="sched-alert__time">Checked just now</span></div>' +
          '<div class="sched-alert__body"><p>1 ' + word + " along your route: <strong>" + esc(top.report.street + ", " + top.report.barangay.replace(/, .*/, "")) + "</strong> — reported " + FDA.ui.timeAgo(top.report.ts) + ", " + top.report.still + ' still-flooded confirmation' + (top.report.still === 1 ? "" : "s") + '.</p>' +
          '<div class="sched-alert__actions"><a class="btn btn--primary btn--sm" href="routes.html?id=' + r.id + '">View on route</a><a class="btn btn--outline btn--sm" href="report-details.html?id=' + top.report.id + '">View report</a></div></div></section>';
      }
      return '<section class="card sched-alert sched-alert--clear">' + clearIcon + "<div><strong>Before your " + dep + " trip · " + esc(r.name) + "</strong><span>No recent flood reports along this route. Check local conditions before leaving.</span></div></section>";
    }).join("");
    examples.insertAdjacentHTML("beforeend", html || '<p class="text-small text-muted">Turn on a schedule to see its route check here.</p>');

    /* phone */
    var first = on.map(function (s) { var r = routeOf(s), res = FDA.agent.routeCheck(r, db.reports); return { s: s, r: r, top: res.warnings[0] || res.possible[0] }; }).filter(function (x) { return x.top; })[0];
    var card = $(".trip-card"), advice = $(".trip-advice"), actions = $(".trip-actions"), banner = $(".travel-check");
    [card, advice, actions].forEach(function (n) { n.hidden = !first; });
    var tagM = $(".my-schedules__head .badge--sample"); if (tagM) tagM.textContent = "DEMO DATA";
    banner.hidden = !first; // the red bar only shows when there is something to warn about
    if (first) {
      $(".travel-check__label").textContent = "Travel check · " + S.checkTimeText(first.s);
      $(".travel-check__sub").textContent = "Before your " + S.clockText(first.s.time) + " trip · " + first.r.name;
      var t = $(".travel-check__title"), ic = t.querySelector("svg");
      t.textContent = ""; t.appendChild(ic);
      t.append(first.top.report.status === "flood-warning" ? " Flood warning on your route" : " Possible flood near your route");
    }
    if (!first) return;
    $(".trip-card__thumb").src = first.top.report.photo;
    $(".trip-card__title").textContent = first.top.report.street + ", " + first.top.report.barangay.replace(/, .*/, "");
    $(".trip-card__meta").textContent = FDA.ui.timeAgo(first.top.report.ts) + " · " + first.top.where.toLowerCase();
    $(".trip-card .badge").outerHTML = FDA.ui.badge(first.top.report.status);
    $(".trip-actions a").href = "routes.html?id=" + first.r.id;
    var remindAt = new Date(new Date().setHours(+first.s.time.split(":")[0], +first.s.time.split(":")[1] - 10, 0, 0));
    var rb = $(".trip-actions button");
    rb.textContent = "Remind " + remindAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/, "");
    rb.onclick = function () {
      var at = remindAt.getTime() > Date.now() ? remindAt.getTime() : Date.now() + 10 * 60000;
      (db.reminders = db.reminders || []).push({ userId: user.id, at: at, title: "Time to leave soon: " + first.r.name, text: "Check the flood report on " + first.top.report.street + " before you go.", done: false });
      FDA.store.save(); FDA.ui.toast("We'll remind you at " + FDA.ui.clock(at) + " while the app is open.", "success");
    };
  }

  function render() { drawList(); drawChecks(); }
  loadForm(null); render();
})();
