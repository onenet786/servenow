/* ServeNow auth pages: small UI helpers (login, register, forgot, reset).
   Loaded after app.js. It never changes the auth logic in app.js or the
   page scripts. It only:
   - shows/hides passwords (accessible toggle buttons),
   - puts submit buttons into a loading state while a request runs and
     restores them when app.js shows a toast (error/warning/info) or after
     a safety timeout,
   - mirrors error/warning toasts into the inline #snAuthAlert region,
   - shows a password-length/strength hint where present. */
(function () {
  "use strict";

  var SAFETY_MS = 20000;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  // ---- Password show/hide ------------------------------------------------
  function initPasswordToggles() {
    $all(".sn-pw-toggle").forEach(function (btn) {
      var input = document.getElementById(btn.getAttribute("aria-controls"));
      if (!input) return;
      btn.addEventListener("click", function () {
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.setAttribute("aria-pressed", show ? "true" : "false");
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        var icon = btn.querySelector("i");
        if (icon) {
          icon.classList.toggle("fa-eye", !show);
          icon.classList.toggle("fa-eye-slash", show);
        }
      });
    });
  }

  // ---- Loading state -------------------------------------------------------
  var active = []; // buttons currently loading

  function setLoading(btn, on) {
    if (!btn) return;
    var label = btn.querySelector(".sn-submit__label");
    if (on) {
      if (btn.classList.contains("is-loading")) return;
      if (label && !btn.dataset.snIdle) btn.dataset.snIdle = label.textContent;
      if (label && btn.dataset.loadingText) label.textContent = btn.dataset.loadingText;
      btn.classList.add("is-loading");
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      clearTimeout(btn._snTimer);
      btn._snTimer = setTimeout(function () {
        setLoading(btn, false);
      }, SAFETY_MS);
      if (active.indexOf(btn) === -1) active.push(btn);
    } else {
      clearTimeout(btn._snTimer);
      if (label && btn.dataset.snIdle) label.textContent = btn.dataset.snIdle;
      btn.classList.remove("is-loading");
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      active = active.filter(function (b) {
        return b !== btn;
      });
    }
  }

  function restoreAll(type) {
    active.slice().forEach(function (btn) {
      // Login keeps spinning on success: app.js redirects right after.
      var form = btn.form;
      if (type === "success" && form && form.dataset.snKeepOnSuccess === "true") return;
      setLoading(btn, false);
    });
  }

  function initLoading() {
    // Capture phase on document runs BEFORE the form's own submit handlers
    // (handleLogin/handleRegister/page scripts), so even a warning that a
    // handler shows synchronously is seen by the toast observer below.
    document.addEventListener(
      "submit",
      function (e) {
        var form = e.target;
        if (!form || !form.matches || !form.matches("form[data-sn-loading]")) return;
        var btn = form.querySelector(".sn-submit");
        hideAlert();
        setLoading(btn, true);
      },
      true
    );

    // Buttons outside a form (forgot-password "Verify code").
    $all("button[data-sn-loading-click]").forEach(function (btn) {
      btn.addEventListener(
        "click",
        function () {
          hideAlert();
          setLoading(btn, true);
        },
        true
      );
    });
  }

  // ---- Toast observer + inline alert -------------------------------------
  var alertEl = null;

  function hideAlert() {
    if (alertEl) {
      alertEl.hidden = true;
      alertEl.className = "sn-authx-alert";
    }
  }

  function showAlert(type, title, message) {
    if (!alertEl) return;
    var text = alertEl.querySelector(".sn-authx-alert__text");
    var icon = alertEl.querySelector("i");
    if (!text) return;
    text.textContent = (title ? title + ": " : "") + (message || "");
    alertEl.className = "sn-authx-alert" + (type === "warning" ? " is-warning" : type === "success" ? " is-success" : "");
    if (icon) {
      icon.className =
        "fas " + (type === "success" ? "fa-circle-check" : type === "warning" ? "fa-triangle-exclamation" : "fa-circle-exclamation");
    }
    alertEl.hidden = false;
  }

  function toastType(node) {
    var c = node.classList;
    if (c.contains("error")) return "error";
    if (c.contains("warning")) return "warning";
    if (c.contains("success")) return "success";
    return "info";
  }

  function onToast(node) {
    var type = toastType(node);
    var t = node.querySelector(".toast-title");
    var m = node.querySelector(".toast-message");
    var title = t ? t.textContent.trim() : "";
    var message = m ? m.textContent.trim() : "";
    if (type === "error" || type === "warning") showAlert(type, title, message);
    else hideAlert();
    restoreAll(type);
  }

  function initToastObserver() {
    alertEl = document.getElementById("snAuthAlert");
    var observe = function (container) {
      new MutationObserver(function (records) {
        records.forEach(function (r) {
          Array.prototype.forEach.call(r.addedNodes, function (n) {
            if (n.nodeType === 1 && n.classList.contains("toast")) onToast(n);
          });
        });
      }).observe(container, { childList: true });
    };
    var container = document.getElementById("toastContainer");
    if (container) observe(container);

    // A verification modal (app.js) means the request finished.
    new MutationObserver(function () {
      if (document.getElementById("verificationModal")) restoreAll("info");
    }).observe(document.body, { childList: true });
  }

  // ---- Password strength (register) --------------------------------------
  function initStrength() {
    var input = document.querySelector("input[data-sn-strength]");
    if (!input) return;
    var meter = document.getElementById(input.dataset.snStrength);
    var hint = document.getElementById("passwordHint");
    var confirm = document.getElementById("confirmPassword");
    var matchHint = document.getElementById("confirmHint");

    function level(v) {
      if (!v) return 0;
      if (v.length < 8) return 1;
      var kinds = 0;
      if (/[a-z]/.test(v)) kinds++;
      if (/[A-Z]/.test(v)) kinds++;
      if (/\d/.test(v)) kinds++;
      if (/[^A-Za-z0-9]/.test(v)) kinds++;
      return v.length >= 12 || kinds >= 3 ? 3 : 2;
    }

    function update() {
      var v = input.value;
      var l = level(v);
      if (meter) meter.dataset.level = String(l);
      if (hint) {
        if (!v) {
          hint.textContent = "Use at least 8 characters.";
          hint.className = "sn-hint";
        } else if (l === 1) {
          hint.textContent = 8 - v.length + " more character" + (8 - v.length === 1 ? "" : "s") + " needed (minimum 8).";
          hint.className = "sn-hint is-bad";
        } else if (l === 2) {
          hint.textContent = "Good. Mixing letters, numbers and symbols makes it stronger.";
          hint.className = "sn-hint is-ok";
        } else {
          hint.textContent = "Strong password.";
          hint.className = "sn-hint is-ok";
        }
      }
      updateMatch();
    }

    function updateMatch() {
      if (!confirm || !matchHint) return;
      if (!confirm.value) {
        matchHint.textContent = "";
        matchHint.className = "sn-hint";
        confirm.removeAttribute("aria-invalid");
        return;
      }
      var ok = confirm.value === input.value;
      matchHint.textContent = ok ? "Passwords match." : "Passwords don't match yet.";
      matchHint.className = "sn-hint " + (ok ? "is-ok" : "is-bad");
      if (ok) confirm.removeAttribute("aria-invalid");
      else confirm.setAttribute("aria-invalid", "true");
    }

    input.addEventListener("input", update);
    if (confirm) confirm.addEventListener("input", updateMatch);
    update();
  }

  // SMIL ignores CSS, so stop the decorative rider for reduced-motion users.
  function initMotion() {
    var svg = document.querySelector(".sn-authx-route");
    if (!svg || typeof svg.pauseAnimations !== "function" || !window.matchMedia) return;
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    var apply = function () {
      if (mq.matches) {
        svg.setCurrentTime(3);
        svg.pauseAnimations();
      } else {
        svg.unpauseAnimations();
      }
    };
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply);
  }

  function init() {
    initMotion();
    initPasswordToggles();
    initLoading();
    initToastObserver();
    initStrength();
  }

  // Public hooks for google-signin.js and page scripts.
  window.snAuthUi = {
    setLoading: setLoading,
    showAlert: showAlert,
    hideAlert: hideAlert,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
