/* ServeNow web: "Continue with Google" (Google Identity Services).
   Loaded after app.js (and servenow-auth.js) on login.html and register.html.
   - Renders Google's official button into #snGoogleBtn (no custom button).
   - Sends the ID token to POST /api/auth/google-mobile and, on success, uses
     the same completeLoginSuccess(data) path as the password login.
   - If the GIS script is blocked or offline, the "or" divider and the
     Google area stay hidden. */
(function () {
  "use strict";

  var CLIENT_ID = "123484088318-ek8r1kufci04k5mldr8tqsnnihqfnd4s.apps.googleusercontent.com";
  var WAIT_MS = 10000;

  var area = document.getElementById("snGoogleArea");
  var slot = document.getElementById("snGoogleSlot");
  var target = document.getElementById("snGoogleBtn");
  if (!area || !slot || !target) return;

  var initialised = false;
  var lastWidth = 0;
  var busy = false;

  function gis() {
    return window.google && window.google.accounts && window.google.accounts.id;
  }

  function setBusy(on) {
    busy = on;
    slot.classList.toggle("is-busy", on);
    slot.setAttribute("aria-busy", on ? "true" : "false");
  }

  function fail(title, message) {
    setBusy(false);
    if (typeof showError === "function") showError(title, message, 4000);
    else if (window.snAuthUi) window.snAuthUi.showAlert("error", title, message);
  }

  async function onCredential(response) {
    if (busy) return;
    var credential = response && response.credential;
    if (!credential) {
      fail("Google sign-in failed", "Google did not return a sign-in token. Please try again.");
      return;
    }
    setBusy(true);
    if (window.snAuthUi) window.snAuthUi.hideAlert();
    try {
      var base = typeof API_BASE === "string" ? API_BASE : "";
      var res = await fetch(base + "/api/auth/google-mobile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: credential }),
      });
      var data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
      if (data && data.success && data.token && data.user && typeof completeLoginSuccess === "function") {
        completeLoginSuccess(data); // same storage + role redirect as password login
        return; // keep the busy state while the page redirects
      }
      fail("Google sign-in failed", (data && data.message) || "Google sign-in failed. Please try again.");
    } catch (err) {
      console.error("Google sign-in error:", err);
      fail("Google sign-in failed", "Could not reach ServeNow. Check your connection and try again.");
    }
  }

  function render() {
    var id = gis();
    if (!id) return;
    var width = Math.max(200, Math.min(400, Math.floor(slot.clientWidth || area.clientWidth || 320)));
    if (width === lastWidth) return;
    lastWidth = width;
    target.innerHTML = "";
    id.renderButton(target, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "rectangular",
      text: "continue_with",
      logo_alignment: "center",
      width: width,
      locale: "en",
    });
  }

  function start() {
    var id = gis();
    if (!id || initialised) return;
    initialised = true;
    try {
      id.initialize({
        client_id: CLIENT_ID,
        callback: onCredential,
        ux_mode: "popup",
        auto_select: false,
        cancel_on_tap_outside: true,
        context: area.dataset.context === "signup" ? "signup" : "signin",
        itp_support: true,
      });
      area.hidden = false; // show before measuring width
      render();
      var t = null;
      window.addEventListener("resize", function () {
        clearTimeout(t);
        t = setTimeout(render, 200);
      });
    } catch (err) {
      console.error("Google sign-in unavailable:", err);
      area.hidden = true;
    }
  }

  // Exposed for diagnostics/tests (same function GIS calls).
  window.snGoogleSignIn = { handleCredential: onCredential };

  // Wait for the async GIS script; give up quietly if it never arrives.
  var script = document.getElementById("gsiClient");
  if (script) {
    script.addEventListener("load", start);
    script.addEventListener("error", function () {
      area.hidden = true;
    });
  }
  var waited = 0;
  (function poll() {
    if (initialised) return;
    if (gis()) return start();
    waited += 250;
    if (waited < WAIT_MS) setTimeout(poll, 250);
  })();
})();
