/** Flood reports list: search, filters, status counts and paging */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var db = FDA.store.db();

  var PAGE_SIZE = 7;
  var STATUSES = ["flood-warning", "possible-flood", "unclear-photo", "no-flood"];
  var STATUS_BY_LABEL = { "Flood warning": "flood-warning", "Possible flood": "possible-flood", "Unclear photo": "unclear-photo", "No flood": "no-flood" };
  var HOURS = { "Last 24 hours": 24, "Today": 24, "Last 3 days": 72, "Last 7 days": 168 };

  var search = $("#search"), status = $("#status"), date = $("#date"), age = $("#age");
  var list = $(".report-list ul"), summary = $$(".status-summary__item");
  var info = $(".pagination span"), prev = $(".pagination__buttons button:first-child"), next = $(".pagination__buttons button:last-child");
  var page = 0;

  // "Today" really means the last 24 hours in this prototype
  $$("option", date).forEach(function (o) { if (o.textContent === "Today") o.textContent = "Last 24 hours"; });
  var tag = $(".page-heading__aside .badge--sample"); if (tag) tag.textContent = "DEMO DATA";

  function base() {
    var q = search.value.trim().toLowerCase(), hours = HOURS[date.value] || 24, now = Date.now();
    return db.reports.filter(function (r) {
      if (r.removed) return false;
      if (now - r.ts > hours * 3600000) return false;
      if (age.value === "Hide outdated" && !FDA.agent.isRecent(r, now)) return false;
      if (q && (r.street + " " + r.barangay + " " + r.city).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return b.ts - a.ts; });
  }

  function row(r) {
    var outdated = !FDA.agent.isRecent(r);
    var dupBadge = "";
    if (r.dupOf) dupBadge = '<span class="badge badge--duplicate badge--sm">' + FDA.ui.svg("duplicate") + "Duplicate of #" + r.dupOf + "</span>";
    else if (r.dupCandidate && r.review !== "approved") dupBadge = '<span class="badge badge--duplicate badge--sm">' + FDA.ui.svg("duplicate") + "Same area as #" + r.dupCandidate + "?</span>";
    return '<li><a class="report-row' + (outdated ? " report-row--outdated" : "") + '" href="report-details.html?id=' + r.id + '">' +
      '<span class="report-row__id">#' + r.id + "</span>" +
      '<span class="report-row__time">' + FDA.ui.clock(r.ts) + "<small>" + FDA.ui.timeAgo(r.ts) + "</small></span>" +
      '<span class="report-row__place"><strong>' + esc(r.street) + "</strong><small>" + esc(r.barangay + ", " + r.city) + "</small></span>" +
      '<span class="report-row__thumb-cell"><img class="report-row__thumb" src="' + esc(r.photo) + '" alt="" width="52" height="36"></span>' +
      '<span class="report-row__prob">' + FDA.ui.reportProbability(r) + "</span>" +
      '<span class="report-row__status">' + FDA.ui.badge(r.status) +
      (outdated ? '<span class="badge badge--outdated badge--sm">' + FDA.ui.svg("clock") + "May be outdated</span>" : "") + dupBadge + "</span>" +
      '<span class="report-row__note">' + esc(r.note ? shortNote(r) : "") + "</span></a></li>";
  }
  function shortNote(r) { return FDA.agent.recommendations[r.status].short; }

  function render() {
    var all = base();
    // counts follow the search / date / age filters, but not the status filter
    summary.forEach(function (btn, i) {
      $(".status-summary__count", btn).textContent = all.filter(function (r) { return r.status === STATUSES[i]; }).length;
      btn.setAttribute("aria-pressed", String(STATUS_BY_LABEL[status.value] === STATUSES[i]));
    });

    var wanted = STATUS_BY_LABEL[status.value];
    var rows = wanted ? all.filter(function (r) { return r.status === wanted; }) : all;
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    var slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    list.innerHTML = slice.length ? slice.map(row).join("") : '<li style="padding:24px;text-align:center;color:var(--color-text-muted)">No reports match these filters.</li>';
    info.textContent = rows.length
      ? "Showing " + (page * PAGE_SIZE + 1) + "–" + (page * PAGE_SIZE + slice.length) + " of " + rows.length + " report" + (rows.length > 1 ? "s" : "") + " · Demo data"
      : "No reports · Demo data";
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
  }

  function reset() { page = 0; render(); }
  $(".report-filters .btn--primary").addEventListener("click", reset);
  $(".report-filters").addEventListener("submit", function (e) { e.preventDefault(); reset(); });
  [status, date, age].forEach(function (s) { s.addEventListener("change", reset); });
  search.addEventListener("input", reset);
  summary.forEach(function (btn, i) {
    btn.addEventListener("click", function () {
      var label = Object.keys(STATUS_BY_LABEL).filter(function (k) { return STATUS_BY_LABEL[k] === STATUSES[i]; })[0];
      status.value = status.value === label ? "All statuses" : label; reset();
    });
  });
  prev.addEventListener("click", function () { page--; render(); });
  next.addEventListener("click", function () { page++; render(); });

  var viewButtons = $$(".view-switch__option");
  viewButtons[1].addEventListener("click", function () { location.href = "map.html"; });

  render();
})();
