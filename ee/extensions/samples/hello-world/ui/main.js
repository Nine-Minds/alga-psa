// Minimal client script for Hello World extension UI
(function () {
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get("extensionId") || "unknown";
  const el = document.getElementById("ctx");
  if (el) {
    el.textContent = `extensionId: ${extensionId}`;
  }
  // Signal ready (placeholder; real SDK would postMessage to host)
  // console.log("Hello World extension loaded");
})();