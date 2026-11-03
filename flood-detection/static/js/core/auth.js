/**
 * Accounts and sign-in, through the Flask server (accounts.py).
 *
 * Roles: guest (not signed in), user, moderator. Guests can view everything;
 * reporting, confirming, commenting, flagging, routes, schedules and
 * notifications need an account. Moderator accounts are created by an
 * administrator:  flask --app app create-user --moderator .
 *
 * Who is signed in comes from /api/auth/me.js, which static/js/app.js loads
 * before this file (window.FDA_ME). So FDA.auth.current() stays a plain,
 * synchronous call, and login / register / logout return Promises.
 *
 * Until the other pages are moved to the database, the signed-in user is also
 * copied into the browser data (FDA.store) so routes, schedules, notifications
 * and area alerts keep working for them.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var NO_SERVER = "Accounts need the server. Start it with  flask --app app run  and open http://127.0.0.1:5000.";
  var NO_REACH = "The server can't be reached. Check that Flask is running, then try again.";

  function normLogin(v) {
    v = String(v || "").trim().toLowerCase();
    if (/^[+\d][\d\s-]{8,}$/.test(v)) { // mobile number: compare digits only, 09xx and +639xx are the same
      v = v.replace(/\D/g, "");
      if (v.indexOf("0") === 0) v = "63" + v.slice(1);
    }
    return v;
  }

  function isLoginValid(v) {
    v = String(v || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^(\+?63|0)9\d{9}$/.test(v.replace(/[\s-]/g, ""));
  }

  function rules(pw) {
    return { length: pw.length >= 8, number: /\d/.test(pw), case: /[a-z]/.test(pw) && /[A-Z]/.test(pw) };
  }

  /* Keep a copy of the signed-in user in the browser data, for the pages not yet on the database. */
  function mirror(user) {
    if (!user || !FDA.store) return;
    var db = FDA.store.db(), copy = { id: user.id, name: user.name, login: user.login, role: user.role, homeCity: user.homeCity, homeBarangay: user.homeBarangay };
    var i = -1;
    db.users.forEach(function (u, k) { if (u.id === user.id) i = k; });
    if (i < 0) db.users.push(copy);
    else if (JSON.stringify(db.users[i]) !== JSON.stringify(copy)) db.users[i] = copy;
    else return;
    FDA.store.save();
  }

  var mirrored = false;

  function signedIn(res) {
    window.FDA_ME = res.data.user;
    mirrored = false;
    mirror(res.data.user);
    return { ok: true, user: res.data.user };
  }

  FDA.auth = {
    normLogin: normLogin,
    isLoginValid: isLoginValid,
    rules: rules,
    /** 0–3 filled bars and a label for the register page. */
    strength: function (pw) {
      var r = rules(pw), n = (r.length ? 1 : 0) + (r.number ? 1 : 0) + (r.case ? 1 : 0);
      if (!pw) return { bars: 0, label: "" };
      return { bars: n, label: n === 3 ? "Strong" : n === 2 ? "Good" : "Weak" };
    },

    /** The signed-in user, or null for a guest. */
    current: function () {
      var u = window.FDA_ME || null;
      if (u && !mirrored) { mirrored = true; mirror(u); }
      return u;
    },
    isModerator: function () { var u = FDA.auth.current(); return !!u && u.role === "moderator"; },
    initials: function (u) { return u.name.split(/\s+/).map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase(); },

    /** @returns {Promise<{ok:boolean, error?:string, user?:object}>} */
    login: function (login, password, remember) {
      if (!FDA.api.available()) return Promise.resolve({ ok: false, error: NO_SERVER });
      return FDA.api.post("/api/auth/login", { login: login, password: password, remember: !!remember }).then(function (res) {
        return res.ok ? signedIn(res) : { ok: false, error: res.data.error || "Sign-in failed. Please try again." };
      }, function () { return { ok: false, error: NO_REACH }; });
    },

    /** data: {name, login, password, confirm, barangay, agree}  @returns {Promise<{ok, user?, errors?:{field:message}}>} */
    register: function (data) {
      // the same checks as the server, so most mistakes show at once
      var errors = {};
      if (!String(data.name || "").trim()) errors.name = "Enter your full name.";
      if (!isLoginValid(data.login)) errors.login = "Enter a valid email or a mobile number like 0917 123 4567.";
      var r = rules(data.password || "");
      if (!(r.length && r.number && r.case)) errors.password = "Use at least 8 characters, a number, and upper and lower case letters.";
      if (data.password !== data.confirm) errors.confirm = "The passwords do not match.";
      if (!data.agree) errors.agree = "Please agree to the Terms of Use and Privacy Notice to continue.";
      if (Object.keys(errors).length) return Promise.resolve({ ok: false, errors: errors });
      if (!FDA.api.available()) return Promise.resolve({ ok: false, errors: { login: NO_SERVER } });

      return FDA.api.post("/api/auth/register", data).then(function (res) {
        if (res.ok) return signedIn(res);
        return { ok: false, errors: res.data.errors || { login: res.data.error || "Could not create the account. Please try again." } };
      }, function () { return { ok: false, errors: { login: NO_REACH } }; });
    },

    /** @returns {Promise<void>} */
    logout: function () {
      window.FDA_ME = null;
      if (!FDA.api.available()) return Promise.resolve();
      return FDA.api.post("/api/auth/logout", {}).then(function () {}, function () {});
    }
  };
})();
