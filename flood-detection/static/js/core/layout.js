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
  var NEEDS_USER = { routes: 1, schedules: 1, notifications: 1 };
  var NEEDS_MODERATOR = { moderation: 1 };
  if ((NEEDS_USER[page] && !user) || (NEEDS_MODERATOR[page] && !(user && user.role === "moderator"))) {
    location.replace(FDA.ui.url("auth/login.html") + "?next=" + encodeURIComponent(page + ".html"));
    return;
  }

  function signOut(e) {
    if (e) e.preventDefault();
    FDA.auth.logout();
    location.href = FDA.ui.url("auth/login.html");
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

    var last = $$('.bottom-nav__item[href$="auth/login.html"]')[0];
    if (last) {
      var node = Array.prototype.filter.call(last.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })[0];
      if (node) node.textContent = user ? "\n      Log out\n    " : "\n      Login\n    ";
      last.onclick = user ? signOut : null;
    }
  }

  FDA.layout = { refresh: refresh, page: page };
  refresh();

  /* ---------- Pre-departure checks run while any page is open ---------- */
  if (user) {
    FDA.scheduler.runDue();
    refresh();
    setInterval(function () { FDA.scheduler.runDue(); refresh(); }, 60000);
  }
})();
