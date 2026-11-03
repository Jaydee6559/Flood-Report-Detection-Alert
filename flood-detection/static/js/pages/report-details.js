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

  var me = FDA.auth.current(), voter = me ? me.id : null;   // guests can read, but not confirm, comment or flag

  /** Guests: explain and offer the sign-in page. Returns true when the action may go ahead. */
  function signedIn(title) {
    if (me) return true;
    FDA.ui.dialog({ title: title, text: "Anyone can read reports, but this needs an account.", confirm: "Sign in" }).then(function (ok) {
      if (ok) location.href = "auth/login.html?next=" + encodeURIComponent("report-details.html?id=" + r.id);
    });
    return false;
  }

  /* ---------- Summary ---------- */
  $(".breadcrumb [aria-current]").textContent = "#" + r.id;
  document.title = "Report #" + r.id + " · Flood Detection & Alert";
  $(".page-heading h1").textContent = r.street + ", " + r.barangay;
  var tag = $(".page-heading__aside .badge--sample"); if (tag) tag.remove();   // reports are real now (the database)

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

  /** A POST to the server (community_api.py). Resolves with the reply data, or null after showing the error. */
  var sending = false;
  function send(url, body) {
    if (sending) return Promise.resolve(null);
    sending = true;
    return FDA.api.post(url, body || {}).then(function (res) {
      sending = false;
      if (res.ok) return res.data;
      if (res.status === 401) { signedIn("Please sign in again"); return null; }
      FDA.ui.toast(res.data.error || "That did not work. Please try again.", "error");
      return null;
    }, function () {
      sending = false;
      FDA.ui.toast("The server can't be reached. Check your connection and try again.", "error");
      return null;
    });
  }

  /* ---------- Confirmations (one per account; saved on the server) ---------- */
  var btnStill = $(".confirm-card__buttons .btn--primary"), btnNot = $(".confirm-card__buttons .btn--ghost");
  var iconStill = btnStill.querySelector("svg").outerHTML, iconNot = btnNot.querySelector("svg").outerHTML;
  function paintVotes() {
    var mine = r.myVote;
    btnStill.innerHTML = iconStill + " Still flooded · " + (r.still || 0); btnNot.innerHTML = iconNot + " Not flooded · " + (r.not || 0);
    btnStill.className = "btn btn--sm " + (mine === "not" ? "btn--ghost" : "btn--primary");
    btnNot.className = "btn btn--sm " + (mine === "not" ? "btn--primary" : "btn--ghost");
    btnStill.setAttribute("aria-pressed", String(mine === "still")); btnNot.setAttribute("aria-pressed", String(mine === "not"));
    var last = $(".confirm-card__last");
    last.lastChild.textContent = r.lastConfirmTs ? " Last confirmed " + FDA.ui.timeAgo(r.lastConfirmTs) : " Not confirmed yet";
  }
  function vote(kind) {
    if (!signedIn("Sign in to confirm")) return;
    if (r.ownerId === voter) return FDA.ui.toast("You can't confirm your own report.", "error");
    send("/api/reports/" + r.id + "/confirm", { kind: kind }).then(function (data) {
      if (!data) return;
      r = FDA.store.putReport(data.report);   // the server tells the reporter (notifications_api.py)
      paintVotes(); indicators(); FDA.layout.refresh();
    });
  }
  btnStill.addEventListener("click", function () { vote("still"); });
  btnNot.addEventListener("click", function () { vote("not"); });

  /* ---------- Report a problem with this report (goes to the moderators' queue) ---------- */
  var flagBtn = document.createElement("button");
  flagBtn.type = "button"; flagBtn.className = "link-button"; flagBtn.style.marginTop = "8px";
  flagBtn.innerHTML = '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">' + FDA.ui.icon.flag + "</svg> Report a problem with this report";
  $(".confirm-card__last").insertAdjacentElement("afterend", flagBtn);
  flagBtn.hidden = r.ownerId === voter;   // not on your own report
  flagBtn.addEventListener("click", function () {
    if (!signedIn("Sign in to report a problem")) return;
    if (r.myFlag) return FDA.ui.toast("You already reported this. A moderator will look at it.");
    FDA.ui.dialog({ title: "Report a problem?", text: "A moderator will review this report. Use this for photos that are not of a street, the wrong place, or spam.", confirm: "Send to moderators",
      input: { label: "What is wrong? (optional)", placeholder: "e.g. Photo is not from Quezon City" } }).then(function (reason) {
      if (reason === null || reason === false) return;
      send("/api/reports/" + r.id + "/flag", { reason: typeof reason === "string" ? reason : "" }).then(function (data) {
        if (!data) return;
        r = FDA.store.putReport(data.report);
        FDA.ui.toast(data.already ? "You already reported this. A moderator will look at it." : "Thanks. A moderator will review this report.", "success");
      });
    });
  });

  /* ---------- Comments (saved on the server) ---------- */
  var comments = [], commentsLoaded = false;
  function initials(name) { return name.split(/\s+/).map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase(); }

  function paintComments() {
    $("#comments-title").textContent = commentsLoaded ? "Comments (" + comments.length + ")" : "Comments";
    $(".comment-list").innerHTML = !commentsLoaded ? '<li class="text-small text-muted" style="padding:8px 0">Loading comments…</li>'
      : comments.length ? comments.map(function (c) {
        return '<li class="comment"><span class="comment__avatar" aria-hidden="true">' + esc(initials(c.author)) + '</span><div class="comment__meta"><span class="comment__author">' + esc(c.author) + "</span><span>" + FDA.ui.clock(c.ts) + "</span>" +
          (c.mine ? "" : '<button class="comment__report" type="button" data-id="' + c.id + '" aria-label="Report comment by ' + esc(c.author) + '"><svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">' + FDA.ui.icon.flag + "</svg> Report</button>") + "</div>" +
          '<p class="comment__text">' + esc(c.text) + "</p></li>";
      }).join("") : '<li class="text-small text-muted" style="padding:8px 0">No comments yet. Be the first to add one.</li>';
  }
  function loadComments() {
    if (!FDA.api.available()) { commentsLoaded = true; paintComments(); return; }
    FDA.api.get("/api/reports/" + r.id + "/comments").then(function (res) {
      comments = res.ok ? res.data.comments || [] : []; commentsLoaded = true; paintComments();
      if (!res.ok) FDA.ui.toast("The comments could not be loaded.", "error");
    }, function () { commentsLoaded = true; paintComments(); FDA.ui.toast("The comments could not be loaded.", "error"); });
  }

  $(".comment-list").addEventListener("click", function (e) {
    var b = e.target.closest(".comment__report"); if (!b) return;
    if (!signedIn("Sign in to report a comment")) return;
    var c = comments.filter(function (x) { return x.id === +b.dataset.id; })[0];
    if (!c) return;
    if (c.flaggedByMe) return FDA.ui.toast("You already reported this comment.");
    FDA.ui.dialog({ title: "Report this comment?", text: "A moderator will review it. Use this for spam, abuse or comments that are not about this flood.", confirm: "Report comment" }).then(function (ok) {
      if (!ok) return;
      send("/api/comments/" + c.id + "/flag", { reason: "Reported by a user" }).then(function (data) {
        if (!data) return;
        c.flaggedByMe = true;
        FDA.ui.toast(data.already ? "You already reported this comment." : "Thanks. A moderator will review this comment.", "success");
      });
    });
  });

  var input = $("#comment"), post = $(".comment-form .btn");
  function addComment() {
    var text = input.value.trim();
    if (!signedIn("Sign in to comment")) return;
    if (!text) return FDA.ui.fieldError(input, "Write a short comment first.");
    FDA.ui.fieldError(input, "");
    post.disabled = true;
    send("/api/reports/" + r.id + "/comments", { text: text.slice(0, 200) }).then(function (data) {
      post.disabled = false;
      if (!data) return;
      var c = data.comment;
      comments.unshift(c);   // the server tells the reporter (notifications_api.py)
      input.value = ""; paintComments();
    });
  }
  post.addEventListener("click", addComment);
  $(".comment-form").addEventListener("submit", function (e) { e.preventDefault(); addComment(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addComment(); } });

  indicators(); duplicates(); paintVotes(); paintComments(); loadComments();
})();
