/**
 * Small helpers shared by every page: HTML escaping, time formatting, the
 * status badge / probability bar markup used in the design, toasts and a
 * simple confirm/ask dialog.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var ICON = {
    "flood-warning": '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    "possible-flood": '<path d="M12 3c3.6 4.6 6 7.9 6 11.1a6 6 0 0 1-12 0C6 10.9 8.4 7.6 12 3z"/>',
    "unclear-photo": '<path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.4"/>',
    "no-flood": '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.8 2.8 5.2-5.4"/>',
    duplicate: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.6-3.4 3-5 6-5s5.4 1.6 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c2.5.2 4 1.7 4.5 4.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    flag: '<path d="M6 20V4M6 5h11l-2 3.5 2 3.5H6"/>',
    schedule: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    comment: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>'
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  function svg(name, size) {
    return '<svg class="icon icon--' + (size || "sm") + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || "") + "</svg>";
  }

  function clock(ts) { return new Date(ts).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }); }

  function timeAgo(ts, now) {
    var m = Math.max(0, Math.round(((now || Date.now()) - ts) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " h" + (m % 60 ? " " + (m % 60) + " min" : "") + " ago";
    var d = Math.floor(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  /** "9:52 PM" today, "Yesterday", or a short date. */
  function dayLabel(ts) {
    var d = new Date(ts), n = new Date(), startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    if (ts >= startToday) return "Today";
    if (ts >= startToday - 86400000) return "Yesterday";
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  }

  function badge(status, extra) {
    return '<span class="badge badge--' + status + (extra ? " " + extra : "") + '">' + svg(status) + esc(FDA.agent.label(status)) + "</span>";
  }

  function probability(prob, wide) {
    var pct = Math.round(prob * 100);
    var status = FDA.agent.statusFromProbability(prob);
    return '<span class="probability probability--' + status + (wide ? " probability--wide" : "") + '"><span class="probability__value">' + pct +
      '%</span><span class="probability__bar" style="--value: ' + pct + '%" aria-hidden="true"></span></span>';
  }

  /** Probability bar for a stored report (uses the report's own status colour). */
  function reportProbability(r, wide) {
    var pct = Math.round(r.prob * 100);
    return '<span class="probability probability--' + r.status + (wide ? " probability--wide" : "") + '"><span class="probability__value">' + pct +
      '%</span><span class="probability__bar" style="--value: ' + pct + '%" aria-hidden="true"></span></span>';
  }

  /** Water-depth meter for a stored report, or "" when the report is not a flood. */
  function depthBlock(r) {
    var d = FDA.agent.depth(r);
    if (!d) return "";
    var segs = "";
    for (var i = 1; i <= 4; i++) segs += '<span class="depth__seg' + (i <= d.level ? " is-on is-l" + d.level : "") + '"></span>';
    return '<div class="depth" role="group" aria-label="Estimated water depth">' +
      '<div class="depth__head"><span class="depth__label">' + d.label + '</span><span class="depth__range">' + d.range + '</span></div>' +
      '<div class="depth__meter" aria-hidden="true">' + segs + '</div>' +
      '<p class="depth__advice">' + d.advice + '</p>' +
      '<p class="depth__note">' + (d.source === "model" ? "Depth estimated from the photo." : "Rough estimate from the photo. It is not a measurement.") + '</p></div>';
  }

  /* ---------- Styles for the few things the design does not have yet ---------- */
  var css = document.createElement("style");
  css.textContent =
    ".depth{margin-top:12px;padding:10px 12px;border:1px solid var(--color-border,#dbe3ea);border-radius:8px;background:#f8fafc;max-width:420px}" +
    ".depth__head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}" +
    ".depth__label{font-weight:700;font-size:15px}.depth__range{font-size:13px;color:#5d6b78}" +
    ".depth__meter{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:8px 0}" +
    ".depth__seg{height:8px;border-radius:4px;background:#dbe3ea}.depth__seg.is-on{background:#0b5c96}" +
    ".depth__seg.is-l2.is-on{background:#b26b00}.depth__seg.is-l3.is-on{background:#d9670b}.depth__seg.is-l4.is-on{background:#b8281f}" +
    ".depth__advice{font-size:13px;margin:0}.depth__note{font-size:11.5px;color:#6b7c8f;margin:4px 0 0}" +
    ".fda-toasts{position:fixed;z-index:1000;left:50%;bottom:24px;transform:translateX(-50%);display:grid;gap:8px;width:min(92vw,420px);pointer-events:none}" +
    "@media(max-width:899px){.fda-toasts{bottom:calc(var(--bottom-nav-height,64px) + 16px)}}" +
    ".fda-toast{pointer-events:auto;padding:11px 14px;border-radius:10px;background:#173248;color:#fff;font-size:14px;line-height:1.4;box-shadow:0 8px 24px rgba(23,50,72,.28)}" +
    ".fda-toast--error{background:#a3231a}.fda-toast--success{background:#1d6b3a}" +
    ".form-error{margin-top:6px;font-size:13px;line-height:1.4;color:var(--color-danger-text,#a3231a)}" +
    ".form-error[hidden]{display:none}" +
    "[aria-invalid=true]{border-color:var(--color-danger,#b8291f)!important}" +
    "dialog.fda-dialog{border:0;border-radius:14px;padding:22px;width:min(92vw,420px);box-shadow:0 20px 60px rgba(23,50,72,.35);color:var(--color-text,#1d3349)}" +
    "dialog.fda-dialog::backdrop{background:rgba(23,50,72,.45)}" +
    ".fda-dialog h2{font-size:18px;color:var(--color-navy,#173248);margin-bottom:8px}.fda-dialog p{font-size:14px;line-height:1.5}" +
    ".fda-dialog textarea,.fda-dialog input{width:100%;margin-top:12px}" +
    ".fda-dialog__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}" +
    ".fda-dialog__compare{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.fda-dialog__compare img{width:100%;border-radius:8px}" +
    ".fda-dialog__compare figcaption{font-size:12px;margin-top:4px}";
  document.head.appendChild(css);

  var toastBox;
  function toast(message, kind) {
    if (!toastBox) { toastBox = document.createElement("div"); toastBox.className = "fda-toasts"; toastBox.setAttribute("role", "status"); document.body.appendChild(toastBox); }
    var t = document.createElement("div");
    t.className = "fda-toast" + (kind ? " fda-toast--" + kind : "");
    t.textContent = message;
    toastBox.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === "error" ? 6000 : 3500);
  }

  /**
   * Modal dialog.
   * opts: {title, text, html, confirm, cancel, danger,
   *        input:{label,placeholder,required},            one text area
   *        fields:[{name,label,value,required}],           several text inputs
   *        extra:{label,danger}}                           a third button
   * Resolves with true / false; with the typed text (or null) for `input`;
   * with an object (or null) for `fields`; with "extra" when the third button is used.
   */
  function dialog(opts) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog");
      d.className = "fda-dialog";
      var fields = (opts.fields || []).map(function (f, i) {
        return '<label class="form-label" for="fda-f' + i + '" style="display:block;margin-top:12px">' + esc(f.label) + '</label><input class="form-input" id="fda-f' + i + '" name="' + esc(f.name) + '" value="' + esc(f.value || "") + '" style="margin-top:4px">';
      }).join("");
      d.innerHTML = '<form method="dialog"><h2>' + esc(opts.title || "") + "</h2>" +
        (opts.text ? "<p>" + esc(opts.text) + "</p>" : "") + (opts.html || "") + fields +
        (opts.input ? '<label class="form-label" for="fda-dlg-in" style="margin-top:12px;display:block">' + esc(opts.input.label || "") + '</label><textarea class="form-textarea" id="fda-dlg-in" rows="3" placeholder="' + esc(opts.input.placeholder || "") + '"></textarea>' : "") +
        '<p class="form-error" data-err hidden></p>' +
        '<div class="fda-dialog__actions">' +
        (opts.extra ? '<button class="btn ' + (opts.extra.danger ? "btn--danger-outline" : "btn--ghost") + '" type="button" data-act="extra" style="margin-right:auto">' + esc(opts.extra.label) + "</button>" : "") +
        (opts.cancel === false ? "" : '<button class="btn btn--ghost" type="button" data-act="cancel">' + esc(opts.cancel || "Cancel") + "</button>") +
        '<button class="btn ' + (opts.danger ? "btn--danger" : "btn--primary") + '" type="submit">' + esc(opts.confirm || "OK") + "</button></div></form>";
      document.body.appendChild(d);
      var cancelValue = opts.input || opts.fields ? null : false;
      function done(v) { d.close(); d.remove(); resolve(v); }
      function fail(msg) { var er = d.querySelector("[data-err]"); er.textContent = msg; er.hidden = false; }
      var cancelBtn = d.querySelector("[data-act=cancel]"), extraBtn = d.querySelector("[data-act=extra]");
      if (cancelBtn) cancelBtn.addEventListener("click", function () { done(cancelValue); });
      if (extraBtn) extraBtn.addEventListener("click", function () { done("extra"); });
      d.addEventListener("cancel", function (e) { e.preventDefault(); done(cancelValue); });
      d.querySelector("form").addEventListener("submit", function (e) {
        e.preventDefault();
        if (opts.input) {
          var v = d.querySelector("textarea").value.trim();
          if (opts.input.required && !v) return fail("Please write a short reason.");
          return done(v);
        }
        if (opts.fields) {
          var out = {}, bad = null;
          opts.fields.forEach(function (f) { var val = d.querySelector('[name="' + f.name + '"]').value.trim(); out[f.name] = val; if (f.required && !val && !bad) bad = f.label; });
          if (bad) return fail(bad + " is required.");
          return done(out);
        }
        done(true);
      });
      d.showModal();
      var first = d.querySelector("textarea, input") || d.querySelector("[type=submit]");
      first && first.focus();
    });
  }

  /** Show or clear an error message under a field. */
  function fieldError(input, message) {
    var host = input.closest(".input-group") || input;
    var next = host.nextElementSibling;
    var el = next && next.classList && next.classList.contains("form-error") ? next : null;
    if (!message) { if (el) el.hidden = true; input.removeAttribute("aria-invalid"); return; }
    if (!el) { el = document.createElement("p"); el.className = "form-error"; el.setAttribute("role", "alert"); host.insertAdjacentElement("afterend", el); }
    el.textContent = message; el.hidden = false;
    input.setAttribute("aria-invalid", "true");
  }

  /** Make a role="switch" button flip aria-checked and report the new value. */
  function bindSwitch(btn, initial, onChange) {
    function set(v, silent) { btn.setAttribute("aria-checked", String(!!v)); if (!silent && onChange) onChange(!!v); }
    if (initial !== undefined && initial !== null) set(initial, true);
    btn.addEventListener("click", function () { set(btn.getAttribute("aria-checked") !== "true"); });
    return set;
  }

  /** Like bindSwitch, but safe to call again after the page is redrawn (replaces the old handler). */
  function bindSwitchOnce(btn, value, onChange) {
    btn.setAttribute("aria-checked", String(!!value));
    btn.onclick = function () { var v = btn.getAttribute("aria-checked") !== "true"; btn.setAttribute("aria-checked", String(v)); onChange(v); };
  }

  /** Make a group of aria-pressed buttons behave as filters. mode: "multi" or "single". */
  function bindChips(buttons, mode, onChange) {
    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        if (mode === "single") buttons.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        else b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
        onChange(b);
      });
    });
  }

  FDA.ui = {
    esc: esc, svg: svg, icon: ICON, clock: clock, timeAgo: timeAgo, dayLabel: dayLabel,
    badge: badge, probability: probability, reportProbability: reportProbability, depthBlock: depthBlock,
    toast: toast, dialog: dialog, fieldError: fieldError, bindSwitch: bindSwitch, bindSwitchOnce: bindSwitchOnce, bindChips: bindChips,
    $: function (sel, root) { return (root || document).querySelector(sel); },
    $$: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    param: function (name) { return new URLSearchParams(location.search).get(name); },
    /** Link to another page from wherever we are (templates/ or templates/auth/). */
    url: function (page) { return (/\/auth\/[^/]*$/.test(location.pathname) ? "../" : "") + page; }
  };
})();
