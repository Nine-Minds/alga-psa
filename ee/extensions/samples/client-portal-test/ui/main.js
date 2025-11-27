// Client Portal Test Extension UI
// Uses the postMessage proxy pattern to call the WASM handler via the host bridge

(function () {
  const ENVELOPE_VERSION = '1';
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get("extensionId") || "unknown";
  const tenant = params.get("tenant") || "unknown";
  const path = params.get("path") || "/";
  const parentOrigin = params.get("parentOrigin") || window.location.origin;

  const ctxEl = document.getElementById("ctx");
  const handlerEl = document.getElementById("handler-result");

  // Pending proxy requests keyed by request_id
  const pendingRequests = new Map();

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
   * Signal ready to host using Alga envelope protocol
   */
  function signalReady() {
    if (window.parent && window.parent !== window) {
      console.log('[client-portal-test] Signaling ready to host');
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

  /**
   * Listen for messages from the host (parent window)
   */
  function setupMessageListener() {
    window.addEventListener('message', (ev) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.alga !== true || data.version !== ENVELOPE_VERSION) return;

      console.log('[client-portal-test] Received message from host:', data.type);

      if (data.type === 'apiproxy_response') {
        const requestId = data.request_id;
        const pending = pendingRequests.get(requestId);
        if (pending) {
          pendingRequests.delete(requestId);
          if (data.payload.error) {
            pending.reject(new Error(data.payload.error));
          } else {
            // Decode base64 body to Uint8Array
            const bodyBase64 = data.payload.body || '';
            try {
              const binaryString = atob(bodyBase64);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              pending.resolve(bytes);
            } catch (e) {
              pending.reject(new Error('Failed to decode proxy response'));
            }
          }
        }
      }
    });
  }

  /**
   * Call a proxy route via postMessage to the host
   * @param {string} route - The route to call (e.g., '/')
   * @param {object} [payload] - Optional JSON payload to send
   * @returns {Promise<object>} - The JSON response from the handler
   */
  async function callProxy(route, payload) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      console.log(`[client-portal-test] Calling proxy route: ${route}, requestId: ${requestId}`);

      // Store pending request
      pendingRequests.set(requestId, { resolve, reject });

      // Encode payload as base64 if provided
      let bodyBase64;
      if (payload !== undefined) {
        const jsonStr = JSON.stringify(payload);
        const encoder = new TextEncoder();
        const bytes = encoder.encode(jsonStr);
        let binaryString = '';
        for (let i = 0; i < bytes.length; i++) {
          binaryString += String.fromCharCode(bytes[i]);
        }
        bodyBase64 = btoa(binaryString);
      }

      // Send apiproxy message to host
      window.parent.postMessage(
        {
          alga: true,
          version: ENVELOPE_VERSION,
          type: 'apiproxy',
          request_id: requestId,
          payload: { route, body: bodyBase64 }
        },
        '*'
      );

      // Timeout after 15 seconds
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error('Proxy request timed out'));
        }
      }, 15000);
    });
  }

  /**
   * Helper to call proxy and parse JSON response
   */
  async function callProxyJson(route, payload) {
    const bytes = await callProxy(route, payload);
    const decoder = new TextDecoder();
    const text = decoder.decode(bytes);
    return text.length ? JSON.parse(text) : undefined;
  }

  /**
   * Call the WASM handler via the proxy pattern
   */
  async function callHandler() {
    if (handlerEl) {
      handlerEl.innerHTML = `<span class="loading">Calling handler via proxy...</span>`;
    }

    try {
      console.log('[client-portal-test] Calling handler via proxy');
      const data = await callProxyJson('/');

      if (!data) {
        if (handlerEl) {
          handlerEl.innerHTML = `<div class="error">Empty response from handler</div>`;
        }
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
              Handler Response (via Proxy)
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

      console.log('[client-portal-test] handler success via proxy', data);

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
    setupMessageListener();
    signalReady();
    callHandler();
  });
})();
