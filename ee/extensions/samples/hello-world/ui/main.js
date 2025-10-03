// Minimal client script for Hello World extension UI
(function () {
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get("extensionId") || "unknown";
  const el = document.getElementById("ctx");
  if (el) {
    el.textContent = `extensionId: ${extensionId}`;
  }

  // Signal ready to host using Alga envelope protocol
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        alga: true,
        version: '1',
        type: 'ready',
        payload: {}
      },
      '*' // In production, this should be the specific parent origin
    );
  }
})();