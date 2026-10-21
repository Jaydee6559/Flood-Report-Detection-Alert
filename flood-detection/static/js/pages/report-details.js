/** Report details: summary, nearby duplicates, confirmations and comments */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var db = FDA.store.db();

  var id = +FDA.ui.param("id") || (db.reports[0] && db.reports[0].id);
  var r = db.reports.filter(function (x) { return x.id === id; })[0];
  var main = $(".details-main");

  if (!r || r.removed) {
    $(".page-heading h1").textContent = r ? "This report was removed" : "Report not found";
    $(".details-indicators").remove(); $(".details-layout").innerHTML =
      '<p class="card card--padded">' + (r ? "A moderator removed report #" + r.id + "." : "There is no report with that number.") + ' <a class="link" href="reports.html">Back to all reports</a></p>';
    return;
  }

  var me = FDA.auth.current(), voter = me ? me.id : FDA.store.deviceId();
  var voteKey = r.id + "|" + voter;

  /* ---------- Summary ---------- */
  $(".breadcrumb [aria-current]").textContent = "#" + r.id;
  document.title = "Report #" + r.id + " · Flood Detection & Alert";
  $(".page-heading h1").textContent = r.street + ", " + r.barangay;
  var tag = $(".page-heading__aside .badge--sample"); if (tag) tag.textContent = "DEMO DATA";

  var photo = $(".details-summary__photo");
  photo.src = r.photo; photo.alt = "Submitted street photo for report #" + r.id; photo.removeAttribute("width"); photo.removeAttribute("height");
  var dp = FDA.agent.depth(r);
  $(".detail-item__value--strong").textContent = (r.prob >= FDA.agent.config.possibleAt ? "Flood" : "No flood") + " · " + Math.round(r.prob * 100) + "%" + (dp ? " · " + dp.label + " (" + dp.range + ")" : "");
  $(".details-summary .probability").outerHTML = FDA.ui.reportProbability(r, true) + FDA.ui.depthBlock(r);
  var values = $$(".details-summary .detail-item__value");
  values[1].textContent = r.note || FDA.agent.recommendations[r.status].long;
  values[2].textContent = r.desc ? "“" + r.desc + "”" : "The reporter did not add a note.";
  values[3].textContent = r.street + ", " + r.barangay + ", " + r.city + " · Report #" + r.id + (r.dupOf ? " · duplicate of #" + r.dupOf : "");

  function indicators() {
    var box = $(".details-indicators"), recent = FDA.agent.isRecent(r);
    var out = FDA.ui.badge(r.status) +
      '<span class="badge ' + (recent ? "badge--fresh" : "badge--outdated") + '">' + FDA.ui.svg("clock") + "Submitted " + FDA.ui.clock(r.ts) + " · " + FDA.ui.timeAgo(r.ts) + (recent ? "" : " · may be outdated") + "</span>";
    if (r.still) out += '<span class="badge badge--confirmed">' + FDA.ui.svg("people") + r.still + " say still flooded</span>";
    if (r.dupOf) out += '<span class="badge badge--duplicate">' + FDA.ui.svg("duplicate") + "Duplicate of #" + r.dupOf + "</span>";
    box.innerHTML = out;
  }

  /* ---------- Possible duplicates (nearby reports from the last 3 hours) ---------- */
  function duplicates() {
    var sec = $(".duplicates");
    var near = db.reports.filter(function (x) {
      return x.id !== r.id && !x.removed && Math.abs(x.ts - r.ts) <= 3 * 3600000 && FDA.geo.distance(r, x) <= 250 && x.dupOf !== r.id;
    }).sort(function (a, b) { return FDA.geo.distance(r, a) - FDA.geo.distance(r, b); }).slice(0, 3);
    sec.hidden = !near.length;
    if (!near.length) return;
    $(".duplicates__title").lastChild.textContent = " " + near.length + " nearby report" + (near.length > 1 ? "s" : "") + " may describe the same flood";
    $(".duplicates__list").innerHTML = near.map(function (x) {
      var m = Math.round(FDA.geo.distance(r, x) / 10) * 10;
      return '<li class="duplicate-item"><img class="duplicate-item__thumb" src="' + esc(x.photo) + '" alt="" width="52" height="38"><div>' +
        '<strong><a href="report-details.html?id=' + x.id + '">#' + x.id + " · " + esc(x.street) + "</a></strong>" +
        '<span class="duplicate-item__meta">' + FDA.ui.clock(x.ts) + " · about " + m + " m away " + FDA.ui.badge(x.status, "badge--sm") +
        (FDA.agent.isRecent(x) ? "" : ' <span class="badge badge--outdated badge--sm">' + FDA.ui.svg("clock") + "May be outdated</span>") + "</span></div></li>";
    }).join("");
    $(".duplicates__header .link-button").onclick = function () {
      FDA.ui.dialog({
        title: "Compare reports", cancel: false, confirm: "Close",
        html: '<div class="fda-dialog__compare">' + [r].concat(near.slice(0, 1)).map(function (x) {
          return '<figure><img src="' + esc(x.photo) + '" alt="Photo from report #' + x.id + '"><figcaption><strong>#' + x.id + "</strong> · " + FDA.ui.clock(x.ts) + "</figcaption></figure>";
        }).join("") + "</div>"
      });
    };
  }

  /* ---------- Confirmations ---------- */
  var btnStill = $(".confirm-card__buttons .btn--primary"), btnNot = $(".confirm-card__buttons .btn--ghost");
  function paintVotes() {
    var mine = db.votes[voteKey];
    var s = btnStill.querySelector("svg").outerHTML, n = btnNot.querySelector("svg").outerHTML;
    btnStill.innerHTML = s + " Still flooded · " + r.still; btnNot.innerHTML = n + " Not flooded · " + r.not;
    btnStill.className = "btn btn--sm " + (mine === "not" ? "btn--ghost" : "btn--primary");
    btnNot.className = "btn btn--sm " + (mine === "not" ? "btn--primary" : "btn--ghost");
    btnStill.setAttribute("aria-pressed", String(mine === "still")); btnNot.setAttribute("aria-pressed", String(mine === "not"));
    var last = $(".confirm-card__last");
    last.lastChild.textContent = r.lastConfirmTs ? " Last confirmed " + FDA.ui.timeAgo(r.lastConfirmTs) : " Not confirmed yet";
  }
  function vote(kind) {
    if (r.ownerId === voter) return FDA.ui.toast("You can't confirm your own report.", "error");
    var prev = db.votes[voteKey];
    if (prev) r[prev]--;
    if (prev === kind) delete db.votes[voteKey];
    else { db.votes[voteKey] = kind; r[kind]++; r.lastConfirmTs = Date.now(); }
    FDA.store.save();
    if (kind === "still" && db.votes[voteKey] === "still" && r.ownerId.indexOf("u") === 0) {
      FDA.notify.push(r.ownerId, { kind: "report", key: "confirm:" + r.id, title: "Your report #" + r.id + " was confirmed " + r.still + " time" + (r.still > 1 ? "s" : ""), text: r.still + " " + (r.still > 1 ? "people say" : "person says") + " it is still flooded", href: "report-details.html?id=" + r.id, cta: "Open report →" });
    }
    paintVotes(); indicators(); FDA.layout.refresh();
  }
  btnStill.addEventListener("click", function () { vote("still"); });
  btnNot.addEventListener("click", function () { vote("not"); });

  /* ---------- Comments ---------- */
  function initials(name) { return name.split(/\s+/).map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase(); }
  function shortName(name) { var p = name.split(/\s+/); return p.length > 1 ? p[0] + " " + p[p.length - 1][0] + "." : name; }

  function paintComments() {
    var items = db.comments.filter(function (c) { return c.reportId === r.id && !c.removed; }).sort(function (a, b) { return b.ts - a.ts; });
    $("#comments-title").textContent = "Comments (" + items.length + ")";
    $(".comment-list").innerHTML = items.length ? items.map(function (c) {
      return '<li class="comment"><span class="comment__avatar" aria-hidden="true">' + esc(initials(c.author)) + '</span><div class="comment__meta"><span class="comment__author">' + esc(c.author) + "</span><span>" + FDA.ui.clock(c.ts) +
        '</span><button class="comment__report" type="button" data-id="' + c.id + '" aria-label="Report comment by ' + esc(c.author) + '"><svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">' + FDA.ui.icon.flag + "</svg> Report</button></div>" +
        '<p class="comment__text">' + esc(c.text) + "</p></li>";
    }).join("") : '<li class="text-small text-muted" style="padding:8px 0">No comments yet. Be the first to add one.</li>';
  }

  $(".comment-list").addEventListener("click", function (e) {
    var b = e.target.closest(".comment__report"); if (!b) return;
    var c = db.comments.filter(function (x) { return x.id === +b.dataset.id; })[0];
    c.flaggedBy = c.flaggedBy || [];
    if (c.flaggedBy.indexOf(voter) >= 0) return FDA.ui.toast("You already reported this comment.");
    FDA.ui.dialog({ title: "Report this comment?", text: "A moderator will review it. Use this for spam, abuse or comments that are not about this flood.", confirm: "Report comment" }).then(function (ok) {
      if (!ok) return;
      c.flaggedBy.push(voter); c.flags = (c.flags || 0) + 1; c.flagReason = c.flagReason || "Reported by a user";
      FDA.store.save(); FDA.ui.toast("Thanks. A moderator will review this comment.", "success");
    });
  });

  var input = $("#comment"), post = $(".comment-form .btn");
  function addComment() {
    var text = input.value.trim();
    if (!me) {
      FDA.ui.dialog({ title: "Sign in to comment", text: "Anyone can read reports, but comments need an account.", confirm: "Sign in" }).then(function (ok) {
        if (ok) location.href = "auth/login.html?next=" + encodeURIComponent("report-details.html?id=" + r.id);
      });
      return;
    }
    if (!text) return FDA.ui.fieldError(input, "Write a short comment first.");
    FDA.ui.fieldError(input, "");
    var c = { id: FDA.store.nextId("nextComment"), reportId: r.id, author: shortName(me.name), authorId: me.id, ts: Date.now(), text: text.slice(0, 200), flags: 0, removed: false };
    db.comments.push(c); FDA.store.save();
    if (r.ownerId !== me.id && r.ownerId.indexOf("u") === 0) FDA.notify.push(r.ownerId, { kind: "report", key: "comment:" + r.id + ":" + c.id, title: "New comment on your report #" + r.id, text: "“" + c.text + "”", href: "report-details.html?id=" + r.id, cta: "Reply →" });
    input.value = ""; paintComments();
  }
  post.addEventListener("click", addComment);
  $(".comment-form").addEventListener("submit", function (e) { e.preventDefault(); addComment(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addComment(); } });

  indicators(); duplicates(); paintVotes(); paintComments();
})();
