/**
 * Runs on every page: page guards, the header (avatar, notification count,
 * moderator link), the phone bottom bar and the schedule checks.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var $ = FDA.ui.$, $$ = FDA.ui.$$;

  var page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "");
  var user = FDA.auth.current();

  /* ---------- Who may open which page ---------- */
  var NEEDS_USER = { report: 1, routes: 1, schedules: 1, notifications: 1 };   // guests can view, but reporting needs an account
  var NEEDS_MODERATOR = { moderation: 1 };
  if ((NEEDS_USER[page] || NEEDS_MODERATOR[page]) && !user) {
    location.replace(FDA.ui.url("auth/login.html") + "?next=" + encodeURIComponent(page + ".html"));
    return;
  }
  if (NEEDS_MODERATOR[page] && user.role !== "moderator") {   // signed in, but not a moderator: no sign-in loop
    location.replace(FDA.ui.url("map.html"));
    return;
  }

  function signOut(e) {
    if (e) e.preventDefault();
    var who = FDA.auth.current();
    FDA.ui.dialog({
      title: "Sign out?",
      text: who ? "You are signed in as " + who.name + ". You will need to sign in again to report floods, see notifications or use saved routes." : "",
      confirm: "Sign out",
      cancel: "Stay signed in",
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      FDA.auth.logout().then(function () { location.href = FDA.ui.url("auth/login.html"); });
    });
  }

  function refresh() {
    user = FDA.auth.current();

    var bell = $('.icon-button[href*="notifications"]');
    if (bell) {
      bell.style.display = user ? "" : "none";
      var count = user ? FDA.notify.unread(user.id) : 0, badge = $(".icon-button__count", bell);
      if (badge) { badge.textContent = count; badge.style.display = count ? "" : "none"; }
      bell.setAttribute("aria-label", "Notifications" + (count ? ", " + count + " unread" : ""));
    }

    var avatar = $("a.avatar");
    if (avatar) {
      avatar.textContent = user ? FDA.auth.initials(user) : "?";
      avatar.title = user ? "Sign out (" + user.name + ")" : "Sign in";
      avatar.setAttribute("aria-label", avatar.title);
      avatar.onclick = user ? signOut : null;
    }

    var nav = $(".site-nav");
    if (nav && user && user.role === "moderator" && !$('a[href="moderation.html"]', nav)) {
      var a = document.createElement("a");
      a.className = "site-nav__link" + (page === "moderation" ? " site-nav__link--active" : "");
      a.href = "moderation.html"; a.textContent = "Moderation";
      nav.appendChild(a);
    }

    /* Phones hide the header nav, so moderators get a shield button next to the bell (CSS shows it on phones only) */
    var actions = $(".site-header__actions"), mod = $(".icon-button--moderation");
    if (actions && user && user.role === "moderator" && !mod) {
      mod = document.createElement("a");
      mod.className = "icon-button icon-button--moderation" + (page === "moderation" ? " icon-button--active" : "");
      mod.href = FDA.ui.url("moderation.html");
      mod.setAttribute("aria-label", "Moderation");
      mod.title = "Moderation";
      if (page === "moderation") mod.setAttribute("aria-current", "page");
      mod.innerHTML = '<svg class="icon icon--md" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>';
      actions.insertBefore(mod, actions.firstChild);
    } else if (mod && !(user && user.role === "moderator")) {
      mod.remove();
    }

    var last = $$('.bottom-nav__item[href$="auth/login.html"]')[0];
    if (last) {
      var node = Array.prototype.filter.call(last.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })[0];
      if (node) node.textContent = user ? "\n      Log out\n    " : "\n      Login\n    ";
      last.onclick = user ? signOut : null;
    }
  }

  FDA.layout = { refresh: refresh, page: page };
  refresh();

  /* ---------- Rule 2 (area risk) runs when a page opens and every 15 minutes after that ---------- */
  function runAreaJob() { FDA.areas.refresh().then(refresh, function () { /* offline: keep what is on screen */ }); }
  runAreaJob();
  setInterval(runAreaJob, 15 * 60000);

  /* ---------- Pre-departure checks run while any page is open ---------- */
  if (user) {
    FDA.scheduler.runDue();
    refresh();
    setInterval(function () { FDA.scheduler.runDue(); refresh(); }, 60000);
  }
})();
