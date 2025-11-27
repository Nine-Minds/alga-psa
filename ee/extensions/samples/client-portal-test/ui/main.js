// Client Portal Test Extension UI
(function () {
  const ENVELOPE_VERSION = '1';
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get("extensionId") || "unknown";
  const tenant = params.get("tenant") || "unknown";
  const path = params.get("path") || "/";

  const ctxEl = document.getElementById("ctx");
  const handlerEl = document.getElementById("handler-result");

  if (ctxEl) {
    ctxEl.innerHTML = `
      <div class="info-row">
        <span class="info-label">Extension ID</span>
        <span class="info-value">${extensionId}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Tenant</span>
        <span class="info-value">${tenant}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Path</span>
        <span class="info-value">${path}</span>
      </div>
    `;
  }

  /**
   * Resolve the main application's origin (host domain).
   */
  function resolveHostOrigin() {
    const referrer = document.referrer;
    if (referrer) {
      try {
        return new URL(referrer).origin;
      } catch {
        // ignore invalid referrer
      }
    }

    try {
      if (window.parent && window.parent !== window && window.parent.location) {
        return window.parent.location.origin;
      }
    } catch {
      // cross-origin access throws
    }

    return window.location.origin;
  }

  function resolveExtensionId(searchParams) {
    const fromQuery = searchParams.get('extensionId');
    if (fromQuery && fromQuery !== 'unknown') {
      return fromQuery;
    }

    const segments = window.location.pathname.split('/').filter(Boolean);
    const extUiIndex = segments.indexOf('ext-ui');
    if (extUiIndex >= 0 && segments[extUiIndex + 1]) {
      try {
        return decodeURIComponent(segments[extUiIndex + 1]);
      } catch {
        return segments[extUiIndex + 1];
      }
    }
    return null;
  }

  // Signal ready to host using Alga envelope protocol
  function signalReady() {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          alga: true,
          version: ENVELOPE_VERSION,
          type: 'ready',
          payload: {}
        },
        '*'
      );
    }
  }

  async function callHandler() {
    const resolvedExtId = resolveExtensionId(params);
    if (!resolvedExtId) {
      if (handlerEl) {
        handlerEl.innerHTML = `<div class="error">Error: Missing extension context</div>`;
      }
      return;
    }

    try {
      const hostOrigin = resolveHostOrigin();
      const apiUrl = new URL(`/api/ext/${resolvedExtId}/`, hostOrigin).toString();

      console.log(`[client-portal-test] Calling handler at ${apiUrl}`);

      if (handlerEl) {
        handlerEl.innerHTML = `<span class="loading">Calling handler...</span>`;
      }

      const response = await fetch(apiUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
        cache: 'no-cache',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const contentType = response.headers.get('content-type') || '';
      let data = null;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        if (handlerEl) {
          handlerEl.innerHTML = `<div class="error">Non-JSON response (${response.status}): ${text.slice(0, 100)}</div>`;
        }
        return;
      }

      if (!response.ok) {
        const detail = data?.error || data?.message || data?.detail || response.statusText;
        if (handlerEl) {
          handlerEl.innerHTML = `<div class="error">Error (${response.status}): ${detail}</div>`;
        }
        console.warn('[client-portal-test] handler error', { status: response.status, data });
        return;
      }

      // Success - display handler response
      if (handlerEl) {
        handlerEl.innerHTML = `
          <div class="result-box">
            <div class="result-header">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
              </svg>
              Handler Response
            </div>
            <div class="result-row">
              <span class="result-label">Message</span>
              <span class="result-value">${data.message || 'N/A'}</span>
            </div>
            <div class="result-row">
              <span class="result-label">Tenant ID</span>
              <span class="result-value"><code>${data.context?.tenantId || 'N/A'}</code></span>
            </div>
            <div class="result-row">
              <span class="result-label">Extension ID</span>
              <span class="result-value"><code>${data.context?.extensionId || 'N/A'}</code></span>
            </div>
            <div class="result-row">
              <span class="result-label">Request ID</span>
              <span class="result-value"><code>${data.context?.requestId || 'N/A'}</code></span>
            </div>
            <div class="result-row">
              <span class="result-label">Build</span>
              <span class="result-value"><code>${data.build || 'N/A'}</code></span>
            </div>
            <div class="result-row">
              <span class="result-label">Timestamp</span>
              <span class="result-value"><code>${data.timestamp || 'N/A'}</code></span>
            </div>
          </div>
        `;
      }

      console.log('[client-portal-test] handler success', data);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (handlerEl) {
        handlerEl.innerHTML = `<div class="error">Error: ${message}</div>`;
      }
      console.error('[client-portal-test] handler call failed', err);
    }
  }

  // Initialize
  window.addEventListener('load', () => {
    signalReady();
    callHandler();
  });
})();
