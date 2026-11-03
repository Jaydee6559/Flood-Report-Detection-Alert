/**
 * Talking to the Flask server.
 *
 *   FDA.api.available()            -> false when the page was opened from disk (file://): no server, no accounts
 *   FDA.api.get(url)               -> Promise<{ok, status, data}>
 *   FDA.api.post(url, body)        -> Promise<{ok, status, data}>; body is an object (sent as JSON) or FormData
 *
 * Every POST carries the CSRF token (X-CSRFToken header) that /api/auth/me.js put in window.FDA_CSRF.
 * If the server says the token is stale, it fetches a fresh one and tries once more.
 * The promise only rejects when the server can't be reached; check .ok for errors such as a wrong password.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  function parse(r) {
    return r.json().catch(function () { return {}; }).then(function (data) {
      if (data && data.csrf && typeof data.csrf === "string") window.FDA_CSRF = data.csrf;
      return { ok: r.ok, status: r.status, data: data || {} };
    });
  }

  function send(url, body) {
    var form = typeof FormData !== "undefined" && body instanceof FormData;
    var headers = { "X-CSRFToken": window.FDA_CSRF || "" };
    if (!form) headers["Content-Type"] = "application/json";
    return fetch(url, {
      method: "POST", credentials: "same-origin", headers: headers,
      body: form ? body : JSON.stringify(body || {})
    }).then(parse);
  }

  FDA.api = {
    available: function () { return location.protocol === "http:" || location.protocol === "https:"; },
    get: function (url) {
      return fetch(url, { credentials: "same-origin", cache: "no-store" }).then(parse);
    },
    post: function (url, body) {
      return send(url, body).then(function (res) {
        if (res.status !== 400 || res.data.csrf !== true) return res;
        // stale CSRF token (for example the server was restarted): get a fresh one, then retry once
        return FDA.api.get("/api/auth/me").then(function () { return send(url, body); });
      });
    }
  };
})();
