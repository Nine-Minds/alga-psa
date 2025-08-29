// Minimal UI bootstrap for Software One extension
(function () {
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get('extensionId') || 'com.alga.softwareone';
  const p = document.getElementById('info');
  if (p) p.textContent = `extensionId: ${extensionId}`;
})();

