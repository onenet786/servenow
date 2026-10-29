// AIAgent chat assistant: asks the server whether the assistant is on and, for a signed-in person, for a
// short-lived identity token, then loads the AIAgent widget. Loaded by js/app.js and /next/assets/app.js.
// ServeNowAssistant.refresh() reloads it after a sign-in or sign-out without a page reload.
(function () {
  if (window.ServeNowAssistant) return;

  function authToken() {
    try {
      return localStorage.getItem("serveNowToken") || sessionStorage.getItem("serveNowToken") || "";
    } catch (_) {
      return "";
    }
  }

  function unload() {
    document.querySelectorAll("script[data-servenow-assistant]").forEach((s) => s.remove());
    const host = document.getElementById("aiagent-widget");
    if (host) host.remove();
  }

  async function load() {
    const token = authToken();
    const res = await fetch("/api/aiagent/widget", {
      headers: token ? { Authorization: "Bearer " + token } : {},
      cache: "no-store",
    });
    if (!res.ok) return;
    const cfg = await res.json();
    if (!cfg.enabled || !cfg.src || !cfg.key) return;
    unload();
    const s = document.createElement("script");
    s.src = cfg.src;
    s.async = true;
    s.dataset.servenowAssistant = "1";
    s.dataset.key = cfg.key;
    s.dataset.title = "ServeNow help";
    if (cfg.identity) s.dataset.identity = cfg.identity;
    if (cfg.scope) s.dataset.scope = cfg.scope;
    document.body.appendChild(s);
  }

  function refresh() {
    return load().catch(() => {});
  }

  window.ServeNowAssistant = { refresh, unload };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh);
  else refresh();
})();
