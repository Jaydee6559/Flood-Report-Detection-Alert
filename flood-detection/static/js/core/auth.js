/**
 * Accounts and sign-in (prototype).
 *
 * Roles: guest (not signed in), user, moderator.
 * Passwords are hashed with a toy function: fine for a demo, NOT for real
 * accounts. The Flask backend should use Flask-Login + Werkzeug hashing.
 *
 * Demo accounts:  maria@example.com / Flood123   (user)
 *                 moderator@example.com / Moderate123   (moderator)
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

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

    current: function () {
      var db = FDA.store.db(), s = db.session;
      if (!s) return null;
      if (!s.remember) { try { if (!sessionStorage.getItem("fda.live")) return null; } catch (e) { /* ignore */ } }
      return db.users.filter(function (u) { return u.id === s.userId; })[0] || null;
    },
    isModerator: function () { var u = FDA.auth.current(); return !!u && u.role === "moderator"; },
    initials: function (u) { return u.name.split(/\s+/).map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase(); },

    /** @returns {{ok:boolean, error?:string, user?:object}} */
    login: function (login, password, remember) {
      var db = FDA.store.db(), key = normLogin(login);
      var user = db.users.filter(function (u) { return normLogin(u.login) === key; })[0];
      if (!user || user.pw !== FDA.store.hash(password)) return { ok: false, error: "That email/number or password is not right." };
      db.session = { userId: user.id, remember: !!remember };
      try { sessionStorage.setItem("fda.live", "1"); } catch (e) { /* ignore */ }
      FDA.store.save();
      return { ok: true, user: user };
    },

    /** data: {name, login, password, confirm, city, barangay} @returns {{ok, errors?:{field:message}}} */
    register: function (data) {
      var db = FDA.store.db(), errors = {};
      if (!data.name.trim()) errors.name = "Enter your full name.";
      if (!isLoginValid(data.login)) errors.login = "Enter a valid email or a mobile number like 0917 123 4567.";
      else if (db.users.some(function (u) { return normLogin(u.login) === normLogin(data.login); })) errors.login = "That email or number is already registered. Try signing in.";
      var r = rules(data.password);
      if (!(r.length && r.number && r.case)) errors.password = "Use at least 8 characters, a number, and upper and lower case letters.";
      if (data.password !== data.confirm) errors.confirm = "The passwords do not match.";
      if (!data.agree) errors.agree = "Please agree to the Terms of Use and Privacy Notice to continue.";
      if (Object.keys(errors).length) return { ok: false, errors: errors };

      var user = { id: "u" + Date.now().toString(36), name: data.name.trim(), login: data.login.trim(), pw: FDA.store.hash(data.password), role: "user", homeCity: data.city || "", homeBarangay: data.barangay || "" };
      db.users.push(user);
      db.session = { userId: user.id, remember: true };
      try { sessionStorage.setItem("fda.live", "1"); } catch (e) { /* ignore */ }
      FDA.store.save();
      return { ok: true, user: user };
    },

    logout: function () {
      FDA.store.db().session = null;
      try { sessionStorage.removeItem("fda.live"); } catch (e) { /* ignore */ }
      FDA.store.save();
    }
  };
})();
