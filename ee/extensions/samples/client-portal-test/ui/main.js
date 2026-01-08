// Dual Portal Demo Extension UI
// Demonstrates how a single extension can work in both MSP and Client portals
// Uses the postMessage proxy pattern to call the WASM handler via the host bridge

(function () {
  const ENVELOPE_VERSION = '1';
  const params = new URLSearchParams(window.location.search);
  const extensionId = params.get("extensionId") || "unknown";
  const tenant = params.get("tenant") || "unknown";
  const path = params.get("path") || "/";
  const parentOrigin = params.get("parentOrigin") || window.location.origin;

  // Detect which portal we're running in based on the parent URL
  // The iframe URL contains information about the parent context
  const referrer = document.referrer || '';
  const isClientPortal = referrer.includes('/client-portal/') ||
                         window.location.href.includes('/client-portal/');
  const portalType = isClientPortal ? 'client' : 'msp';

  const ctxEl = document.getElementById("ctx");
  const handlerEl = document.getElementById("handler-result");
  const badgeEl = document.getElementById("badge");
  const portalIndicatorEl = document.getElementById("portal-indicator");
  const featuresEl = document.getElementById("features");

  // Pending proxy requests keyed by request_id
  const pendingRequests = new Map();

  /**
   * Apply portal-specific styling and content
   */
  function applyPortalContext() {
    // Add portal class to body for CSS styling
    document.body.classList.add(isClientPortal ? 'client-portal' : 'msp-portal');

    // Update badge
    if (badgeEl) {
      badgeEl.textContent = isClientPortal ? 'Client Portal' : 'MSP Portal';
    }

    // Update portal indicator with icon and message
    if (portalIndicatorEl) {
      const icon = isClientPortal
        ? `<svg viewBox="0 0 20 20" fill="currentColor">
             <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
           </svg>`
        : `<svg viewBox="0 0 20 20" fill="currentColor">
             <path fill-rule="evenodd" d="M7 2a2 2 0 00-2 2v12a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2H7zm3 14a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
           </svg>`;

      const message = isClientPortal
        ? 'Running in <strong>Client Portal</strong> context'
        : 'Running in <strong>MSP Portal</strong> context';

      portalIndicatorEl.innerHTML = `${icon}<span>${message}</span>`;
    }

    // Update features list based on portal
    if (featuresEl) {
      const checkIcon = `<svg viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
      </svg>`;

      const mspFeatures = [
        'View and manage all client data',
        'Access administrative settings',
        'Configure extension for all tenants',
        'View usage analytics and reports',
        'Manage user permissions'
      ];

      const clientFeatures = [
        'View your own data only',
        'Submit support requests',
        'Access self-service portal',
        'View your billing information',
        'Update account preferences'
      ];

      const features = isClientPortal ? clientFeatures : mspFeatures;
      featuresEl.innerHTML = features
        .map(f => `<li>${checkIcon}<span>${f}</span></li>`)
        .join('');
    }
  }

  /**
   * Update context display
   */
  function updateContextDisplay() {
    if (ctxEl) {
      ctxEl.innerHTML = `
        <div class="info-row">
          <span class="info-label">Portal</span>
          <span class="info-value">${isClientPortal ? 'Client Portal' : 'MSP Portal'}</span>
        </div>
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
  }

  /**
   * Signal ready to host using Alga envelope protocol
   */
  function signalReady() {
    if (window.parent && window.parent !== window) {
      console.log('[dual-portal-demo] Signaling ready to host');
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

      console.log('[dual-portal-demo] Received message from host:', data.type);

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
   * @returns {Promise<Uint8Array>} - The raw response bytes from the handler
   */
  async function callProxy(route, payload) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      console.log(`[dual-portal-demo] Calling proxy route: ${route}, requestId: ${requestId}`);

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
      console.log('[dual-portal-demo] Calling handler via proxy');
      // Pass the portal type to the handler so it can customize response
      const data = await callProxyJson('/', { portalType });

      if (!data) {
        if (handlerEl) {
          handlerEl.innerHTML = `<div class="error">Empty response from handler</div>`;
        }
        return;
      }

      // Success - display handler response
      // Format user info for display
      const userDisplay = data.user
        ? `${data.user.userName} (${data.user.userEmail})`
        : 'N/A';
      const userTypeDisplay = data.user?.userType || 'N/A';

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
              <span class="result-label">Current User</span>
              <span class="result-value">${userDisplay}</span>
            </div>
            <div class="result-row">
              <span class="result-label">User Type</span>
              <span class="result-value"><code>${userTypeDisplay}</code></span>
            </div>
            <div class="result-row">
              <span class="result-label">Portal Type</span>
              <span class="result-value"><code>${data.portalType || portalType}</code></span>
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
              <span class="result-label">Timestamp</span>
              <span class="result-value"><code>${data.timestamp || 'N/A'}</code></span>
            </div>
            <div class="result-row">
              <span class="result-label">Version</span>
              <span class="result-value"><code>${data.version || 'N/A'}</code></span>
            </div>
          </div>
        `;
      }

      console.log('[dual-portal-demo] handler success via proxy', data);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (handlerEl) {
        handlerEl.innerHTML = `<div class="error">Error: ${message}</div>`;
      }
      console.error('[dual-portal-demo] handler call failed', err);
    }
  }

  // Initialize
  window.addEventListener('load', () => {
    console.log(`[dual-portal-demo] Initializing in ${portalType} portal context`);
    applyPortalContext();
    updateContextDisplay();
    setupMessageListener();
    signalReady();
    callHandler();
  });
})();
