/** Moderation: report queue, comment queue and review actions (moderators only) */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var db = FDA.store.db();

  var tbody = $(".queue tbody"), filters = $$(".filter-chip"), menu = $$(".mod-menu__item");
  var cq = $(".comment-queue"), cqUl = $(".comment-queue ul");
  var FILTERS = ["all", "dup", "reported", "outdated"];
  var active = "all", selected = null, section = "queue";

  var iconDup = FDA.ui.svg("duplicate"), iconClock = FDA.ui.svg("clock"), iconFlag = FDA.ui.svg("flag");
  var tag = $(".mod-main__head .badge--sample"); if (tag) tag.textContent = "DEMO DATA";

  /* Why a report is in the queue. A report can have more than one reason. */
  function reasons(r) {
    var out = [];
    if (r.dupCandidate && !r.dupOf && r.review !== "approved") out.push({ k: "dup", html: '<span class="badge badge--duplicate">' + iconDup + "Duplicate of #" + r.dupCandidate + "?</span>" });
    if (r.flags && r.review !== "approved") out.push({ k: "reported", html: '<span class="badge badge--reported">' + iconFlag + "Reported by " + r.flags + " user" + (r.flags > 1 ? "s" : "") + "</span>" });
    if (r.status === "flood-warning" && !FDA.agent.isRecent(r) && r.review !== "approved") out.push({ k: "outdated", html: '<span class="badge badge--outdated">' + iconClock + "May be outdated</span>" });
    return out;
  }
  function queue() {
    return db.reports.filter(function (r) { return !r.removed && !r.dupOf && reasons(r).length && r.review !== "later-hide"; })
      .sort(function (a, b) { return (a.review === "later") - (b.review === "later") || b.ts - a.ts; });
  }
  function pendingComments() { return db.comments.filter(function (c) { return !c.removed && c.flags > 0 && !c.kept; }); }
  function reviewedToday() { return db.reports.filter(function (r) { return r.reviewedAt && Date.now() - r.reviewedAt < 86400000; }).length + db.comments.filter(function (c) { return c.reviewedAt && Date.now() - c.reviewedAt < 86400000; }).length; }

  function counts() {
    var q = queue(), c = {};
    FILTERS.forEach(function (k) { c[k] = k === "all" ? q.length : q.filter(function (r) { return reasons(r).some(function (x) { return x.k === k; }); }).length; });
    return c;
  }

  function render() {
    var q = queue(), c = counts();
    var names = ["All", "Duplicates", "Reported", "Outdated"], icons = [null, iconDup, iconFlag, iconClock];
    filters.forEach(function (b, i) { b.innerHTML = (icons[i] || "") + names[i] + " · " + c[FILTERS[i]]; b.setAttribute("aria-pressed", String(FILTERS[i] === active)); });
    var counters = $$(".mod-menu__count");
    counters[0].textContent = c.all; counters[1].textContent = pendingComments().length; counters[2].textContent = c.dup; counters[3].textContent = reviewedToday();

    var rows = active === "all" ? q : q.filter(function (r) { return reasons(r).some(function (x) { return x.k === active; }); });
    if (!rows.some(function (r) { return r.id === selected; })) selected = rows[0] ? rows[0].id : null;
    tbody.innerHTML = rows.length ? rows.map(function (r) {
      return '<tr data-id="' + r.id + '"' + (r.id === selected ? ' aria-selected="true"' : "") + ' style="cursor:pointer"><td class="queue__check"><input type="checkbox" aria-label="Select report #' + r.id + '"' + (r.id === selected ? " checked" : "") + "></td>" +
        '<td class="queue__place"><span class="queue__id">#' + r.id + " · " + esc(r.street) + "</span><small>" + esc(r.barangay) + " · " + FDA.ui.clock(r.ts) + "</small></td>" +
        '<td class="queue__status">' + FDA.ui.badge(r.status) + "<small>" + Math.round(r.prob * 100) + "% probability</small></td>" +
        "<td>" + reasons(r).map(function (x) { return x.html; }).join(" ") + "</td></tr>";
    }).join("") : '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--color-text-muted)">Nothing waiting for review. Nice work.</td></tr>';
    drawComments(); drawReview(); drawMobile();
    $(".mod-main__head h1").textContent = section === "comments" ? "Comment queue" : "Report queue";
    cq.scrollMargin = 0;
  }

  function drawComments() {
    var list = pendingComments();
    $(".comment-queue__head h2").lastChild.textContent = " Comment queue (" + list.length + ")";
    var html = list.length ? list.map(function (c) {
      return '<li class="comment-item" data-id="' + c.id + '"><div class="comment-item__text"><p class="comment-item__quote">“' + esc(c.text) + '”</p><p class="comment-item__meta">On #' + c.reportId + " · " + iconFlag + " " + esc(c.flagReason || "Reported") + " · " + c.flags + " report" + (c.flags > 1 ? "s" : "") + "</p></div>" +
        '<div class="comment-item__actions"><button class="btn btn--ghost btn--sm" type="button" data-act="keep">' + FDA.ui.svg("check") + 'Keep</button><button class="btn btn--danger btn--sm" type="button" data-act="remove">' + '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>Remove</button></div></li>';
    }).join("") : '<li class="text-small text-muted" style="padding:12px 0">No comments waiting for review.</li>';
    cqUl.innerHTML = html;
    mComments.innerHTML = html;
  }

  /* ---------- Phone layout (.mod-mobile): the same queues as tabs, with quick actions only ---------- */
  var mobile = $(".mod-mobile"), mTabs = $$(".mod-tabs .filter-chip"), mComments = $(".mod-mobile .comment-list");
  var mReports = document.createElement("div"); mReports.className = "mod-mobile__reports"; mReports.style.cssText = "display:grid;gap:12px;margin-top:12px";
  mComments.insertAdjacentElement("afterend", mReports);
  var oldCard = $(".mod-mobile__report"); if (oldCard) oldCard.remove();
  var mTab = "comments";
  function drawMobile() {
    var q = queue();
    mTabs[0].textContent = "Reports · " + q.length; mTabs[1].textContent = "Comments · " + pendingComments().length;
    mTabs[0].setAttribute("aria-pressed", String(mTab === "reports")); mTabs[1].setAttribute("aria-pressed", String(mTab === "comments"));
    mComments.hidden = mTab !== "comments"; mReports.hidden = mTab !== "reports";
    mReports.innerHTML = q.length ? q.map(function (r) {
      var other = r.dupCandidate;
      return '<section class="card mod-mobile__report" data-id="' + r.id + '"><div class="mod-mobile__report-row"><img class="mod-mobile__thumb" src="' + esc(r.photo) + '" alt=""><div><p class="mod-mobile__title">#' + r.id + " · " + esc(r.street) + "</p>" +
        FDA.ui.badge(r.status) + " " + reasons(r).map(function (x) { return x.html; }).join(" ") + '</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<button class="btn btn--approve btn--sm" type="button" data-q="approve">Approve</button>' +
        (other ? '<button class="btn btn--duplicate btn--sm" type="button" data-q="dup">Duplicate of #' + other + "</button>" : "") +
        '<button class="btn btn--danger-outline btn--sm" type="button" data-q="remove">Remove…</button></div></section>';
    }).join("") : '<p class="card card--padded text-small text-muted">Nothing waiting for review.</p>';
  }
  mTabs.forEach(function (b, i) { b.addEventListener("click", function () { mTab = i ? "comments" : "reports"; drawMobile(); }); });
  mReports.addEventListener("click", function (e) {
    var b = e.target.closest("[data-q]"); if (!b) return;
    selected = +b.closest("[data-id]").dataset.id;
    acts[{ dup: 0, approve: 1, remove: 3 }[b.dataset.q]].click();
  });

  /* ---------- Review panel ---------- */
  var panel = $(".review");
  function drawReview() {
    var r = db.reports.filter(function (x) { return x.id === selected; })[0];
    panel.hidden = !r;
    if (!r) return;
    $("#review-title").textContent = "Reviewing #" + r.id;
    var other = db.reports.filter(function (x) { return x.id === (r.dupCandidate || -1); })[0];
    var figs = $$(".review__photo", panel);
    function fig(el, rep) {
      if (!rep) { el.hidden = true; return; }
      el.hidden = false; el.querySelector("img").src = rep.photo; el.querySelector("img").alt = "Photo from report #" + rep.id;
      el.querySelector("figcaption").innerHTML = "<strong>#" + rep.id + "</strong><span>" + FDA.ui.clock(rep.ts) + "</span>";
    }
    fig(figs[0], r); fig(figs[1], other);
    var facts = $(".review__facts");
    facts.textContent = other
      ? "About " + Math.round(FDA.geo.distance(r, other) / 10) * 10 + " m apart · " + Math.max(1, Math.round(Math.abs(r.ts - other.ts) / 60000)) + " min apart · " + (r.status === other.status ? "same status" : "different status")
      : "No similar nearby report found.";
    $(".review .text-xs").textContent = other ? "Compare with possible original" : "Photo from this report";
    var b = $$(".review__actions button", panel);
    b[0].hidden = !other; if (other) b[0].lastChild.textContent = "Mark as duplicate of #" + other.id;
  }

  function stamp(r) { r.reviewedAt = Date.now(); }
  function tell(r, title, text) { if (r.ownerId && r.ownerId.indexOf("u") === 0) FDA.notify.push(r.ownerId, { kind: "report", key: "mod:" + r.id + ":" + Date.now(), title: title, text: text, href: "report-details.html?id=" + r.id, cta: "Open report →" }); }

  var acts = $$(".review__actions button", panel);
  acts[0].addEventListener("click", function () { // duplicate
    var r = cur(); if (!r || !r.dupCandidate) return;
    r.dupOf = r.dupCandidate; r.review = "duplicate"; stamp(r); FDA.store.save();
    tell(r, "Your report #" + r.id + " was marked as a duplicate", "Merged with #" + r.dupOf + " by a moderator");
    FDA.ui.toast("Report #" + r.id + " merged with #" + r.dupOf + ".", "success"); render();
  });
  acts[1].addEventListener("click", function () { // approve
    var r = cur(); if (!r) return;
    r.review = "approved"; r.flags = 0; r.dupCandidate = null; stamp(r); FDA.store.save();
    FDA.ui.toast("Report #" + r.id + " approved as a separate report.", "success"); render();
  });
  acts[2].addEventListener("click", function () { // later
    var r = cur(); if (!r) return;
    r.review = "later"; FDA.store.save();
    var rows = queue(); selected = (rows.filter(function (x) { return x.id !== r.id; })[0] || r).id; FDA.ui.toast("Moved to the end of the queue."); render();
  });
  acts[3].addEventListener("click", function () { // remove
    var r = cur(); if (!r) return;
    FDA.ui.dialog({ title: "Remove report #" + r.id + "?", text: "The report disappears from the list and the map. The reporter is told why.", confirm: "Remove report", danger: true, input: { label: "Reason (the reporter will see this)", placeholder: "e.g. Photo does not show a street", required: true } }).then(function (reason) {
      if (reason === null) return;
      r.removed = true; r.review = "removed"; r.removeReason = reason; stamp(r); FDA.store.save();
      tell(r, "Your report #" + r.id + " was removed", reason);
      FDA.ui.toast("Report #" + r.id + " removed.", "success"); render();
    });
  });
  function cur() { return db.reports.filter(function (x) { return x.id === selected; })[0]; }

  tbody.addEventListener("click", function (e) { var tr = e.target.closest("tr[data-id]"); if (tr) { selected = +tr.dataset.id; render(); } });
  filters.forEach(function (b, i) { b.addEventListener("click", function () { active = FILTERS[i]; render(); }); });

  function onCommentAction(e) {
    var b = e.target.closest("button[data-act]"); if (!b) return;
    var c = db.comments.filter(function (x) { return x.id === +b.closest("li").dataset.id; })[0];
    if (b.dataset.act === "keep") { c.kept = true; c.flags = 0; c.reviewedAt = Date.now(); FDA.store.save(); FDA.ui.toast("Comment kept."); render(); }
    else FDA.ui.dialog({ title: "Remove this comment?", text: "“" + c.text + "”", confirm: "Remove", danger: true }).then(function (ok) {
      if (!ok) return; c.removed = true; c.reviewedAt = Date.now(); FDA.store.save(); FDA.ui.toast("Comment removed.", "success"); render();
    });
  }
  cqUl.addEventListener("click", onCommentAction);
  mComments.addEventListener("click", onCommentAction);

  /* Left menu */
  menu.forEach(function (a, i) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      menu.forEach(function (m) { m.classList.toggle("mod-menu__item--active", m === a); if (m === a) m.setAttribute("aria-current", "page"); else m.removeAttribute("aria-current"); });
      section = i === 2 ? "comments" : "queue";
      if (i === 3) active = "dup"; else if (i === 0 || i === 1) active = "all";
      if (i === 4) FDA.ui.toast(reviewedToday() + " item" + (reviewedToday() === 1 ? "" : "s") + " reviewed in the last 24 hours.");
      render();
      if (i === 2) cq.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  var openQueue = $(".comment-queue__head .link"); if (openQueue) openQueue.addEventListener("click", function (e) { e.preventDefault(); menu[2].click(); });

  /* ---------- Flood-spot log: recurring flood spots the agent uses as the S input ---------- */
  (function spotLog() {
    var sec = document.createElement("section");
    sec.className = "card card--padded"; sec.id = "spot-log"; sec.setAttribute("aria-labelledby", "spot-title"); sec.style.marginTop = "16px";
    sec.innerHTML = '<h2 class="heading-sm" id="spot-title">Flood-spot log</h2>' +
      '<p class="text-muted text-sm">Add a place that flooded. If the same corner is added again it counts as another time. These spots feed the agent (recurring spot within 200 m).</p>' +
      '<form id="spot-form" class="form-row" style="margin-top:12px;gap:10px;align-items:end;flex-wrap:wrap" novalidate>' +
      '<div><label class="form-label" for="sp-date">Date seen</label><input class="form-input" id="sp-date" type="date"></div>' +
      '<div><label class="form-label" for="sp-b">Barangay</label><input class="form-input" id="sp-b" list="sp-bl" autocomplete="off"><datalist id="sp-bl"></datalist></div>' +
      '<div><label class="form-label" for="sp-c">Corner</label><input class="form-input" id="sp-c" placeholder="e.g. Banawe cor. Retiro"></div>' +
      '<div><label class="form-label" for="sp-d">Depth</label><select class="form-select" id="sp-d"></select></div>' +
      '<div><label class="form-label" for="sp-p">Who can pass</label><select class="form-select" id="sp-p"></select></div>' +
      '<div><label class="form-label" for="sp-u">Source link (optional)</label><input class="form-input" id="sp-u" type="url" placeholder="https://"></div>' +
      '<button class="btn btn--primary" type="submit">Add sighting</button></form>' +
      '<p class="form-error" id="sp-err" role="alert" hidden></p>' +
      '<div style="overflow-x:auto;margin-top:12px"><table style="width:100%;border-collapse:collapse;font-size:var(--font-size-sm)"><thead><tr><th align="left">Corner</th><th align="left">Barangay</th><th align="left">Times</th><th align="left">Depth</th><th align="left">Last seen</th><th></th></tr></thead><tbody id="sp-body"></tbody></table></div>';
    cq.insertAdjacentElement("afterend", sec);
    $("#sp-bl").innerHTML = FDA.geo.barangays("Quezon City").map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
    $("#sp-d").innerHTML = Object.keys(FDA.hazard.DEPTHS).map(function (k) { return '<option value="' + k + '">' + FDA.hazard.DEPTHS[k].label + "</option>"; }).join("");
    $("#sp-p").innerHTML = Object.keys(FDA.hazard.PASSES).map(function (k) { return '<option value="' + k + '">' + FDA.hazard.PASSES[k] + "</option>"; }).join("");
    $("#sp-date").value = new Date().toISOString().slice(0, 10);

    function draw() {
      var all = FDA.hazard.spots().slice().sort(function (a, b) { return (b.last || "").localeCompare(a.last || ""); });
      $("#sp-body").innerHTML = all.slice(0, 60).map(function (x) {
        return "<tr><td>" + esc(x.corner) + "</td><td>" + esc(x.barangay) + "</td><td>" + x.times + "</td><td>" + esc(FDA.hazard.depth(x.depth).label) + "</td><td>" + esc(x.last) + "</td><td>" +
          (x.seed ? '<small class="text-muted">sample</small>' : '<button class="btn btn--ghost btn--sm" type="button" data-rm="' + esc(x.id) + '">Remove</button>') + "</td></tr>";
      }).join("");
    }
    $("#sp-body").addEventListener("click", function (e) {
      var b = e.target.closest("[data-rm]"); if (!b) return;
      FDA.hazard.removeSpot(b.dataset.rm); draw(); FDA.ui.toast("Sighting removed.");
    });
    $("#spot-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("#sp-err"), b = $("#sp-b").value.trim(), c = $("#sp-c").value.trim(), url = $("#sp-u").value.trim();
      err.hidden = true;
      if (!FDA.hazard.get(b)) { err.textContent = "Choose a barangay from the list."; err.hidden = false; return; }
      if (!c) { err.textContent = "Enter the corner or street."; err.hidden = false; return; }
      if (url && !/^https?:\/\//i.test(url)) { err.textContent = "The source link must start with http:// or https://."; err.hidden = false; return; }
      FDA.hazard.addSpot({ barangay: b, corner: c, date: $("#sp-date").value, depth: $("#sp-d").value, pass: $("#sp-p").value, url: url, source: "Moderator log" });
      $("#sp-c").value = ""; $("#sp-u").value = ""; draw(); FDA.ui.toast("Added to the flood-spot log.", "success");
    });
    draw();
  })();

  render();
})();
