// Dual Portal Demo Extension UI
// Uses @alga/extension-iframe-sdk for postMessage communication

import { IframeBridge } from '@alga-psa/extension-iframe-sdk';

// Initialize the SDK bridge
const bridge = new IframeBridge({
  // Allow wildcard for development; in production the SDK validates parent origin
  devAllowWildcard: true,
});

// Parse URL parameters
const params = new URLSearchParams(window.location.search);
const extensionId = params.get('extensionId') || 'unknown';
const tenant = params.get('tenant') || 'unknown';
const path = params.get('path') || '/';

// Detect which portal we're running in based on the parent URL
const referrer = document.referrer || '';
const isClientPortal =
  referrer.includes('/client-portal/') || window.location.href.includes('/client-portal/');
const portalType = isClientPortal ? 'client' : 'msp';

// DOM elements
const ctxEl = document.getElementById('ctx');
const handlerEl = document.getElementById('handler-result');
const badgeEl = document.getElementById('badge');
const portalIndicatorEl = document.getElementById('portal-indicator');
const featuresEl = document.getElementById('features');

/**
 * Apply portal-specific styling and content
 */
function applyPortalContext(): void {
  document.body.classList.add(isClientPortal ? 'client-portal' : 'msp-portal');

  if (badgeEl) {
    badgeEl.textContent = isClientPortal ? 'Client Portal' : 'MSP Portal';
  }

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

  if (featuresEl) {
    const checkIcon = `<svg viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
    </svg>`;

    const mspFeatures = [
      'View and manage all client data',
      'Access administrative settings',
      'Configure extension for all tenants',
      'View usage analytics and reports',
      'Manage user permissions',
    ];

    const clientFeatures = [
      'View your own data only',
      'Submit support requests',
      'Access self-service portal',
      'View your billing information',
      'Update account preferences',
    ];

    const features = isClientPortal ? clientFeatures : mspFeatures;
    featuresEl.innerHTML = features.map((f) => `<li>${checkIcon}<span>${f}</span></li>`).join('');
  }
}

/**
 * Update context display
 */
function updateContextDisplay(): void {
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
 * Helper to call proxy and parse JSON response
 */
async function callProxyJson<T>(route: string, payload?: unknown): Promise<T | undefined> {
  // Encode payload to Uint8Array if provided
  let payloadBytes: Uint8Array | undefined;
  if (payload !== undefined) {
    const jsonStr = JSON.stringify(payload);
    payloadBytes = new TextEncoder().encode(jsonStr);
  }

  // Use the SDK's uiProxy to make the call
  const responseBytes = await bridge.uiProxy.callRoute(route, payloadBytes);

  // Decode response
  const text = new TextDecoder().decode(responseBytes);
  return text.length ? JSON.parse(text) : undefined;
}

interface HandlerResponse {
  ok?: boolean;
  message?: string;
  user?: {
    userName: string;
    userEmail: string;
    userType: string;
    clientId?: string;
  };
  userError?: string;
  portalType?: string;
  context?: {
    tenantId?: string;
    extensionId?: string;
    requestId?: string;
  };
  timestamp?: string;
  version?: string;
}

/**
 * Call the WASM handler via the SDK's uiProxy
 */
async function callHandler(): Promise<void> {
  if (handlerEl) {
    handlerEl.innerHTML = `<span class="loading">Calling handler via proxy...</span>`;
  }

  try {
    console.log('[dual-portal-demo] Calling handler via SDK proxy');
    const data = await callProxyJson<HandlerResponse>('/', { portalType });

    if (!data) {
      if (handlerEl) {
        handlerEl.innerHTML = `<div class="error">Empty response from handler</div>`;
      }
      return;
    }

    // Format user info for display
    const userDisplay = data.user
      ? `${data.user.userName} (${data.user.userEmail})`
      : data.userError
        ? `Error: ${data.userError}`
        : 'N/A';
    const userTypeDisplay = data.user?.userType || 'N/A';
    const clientIdDisplay = data.user?.clientId || 'N/A';

    if (handlerEl) {
      handlerEl.innerHTML = `
        <div class="result-box">
          <div class="result-header">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
            </svg>
            Handler Response (via SDK Proxy)
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
            <span class="result-label">Client ID</span>
            <span class="result-value"><code>${clientIdDisplay}</code></span>
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

    console.log('[dual-portal-demo] Handler success via SDK proxy', data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (handlerEl) {
      handlerEl.innerHTML = `<div class="error">Error: ${message}</div>`;
    }
    console.error('[dual-portal-demo] Handler call failed', err);
  }
}

// Initialize on load
window.addEventListener('load', () => {
  console.log(`[dual-portal-demo] Initializing in ${portalType} portal context (using SDK)`);
  applyPortalContext();
  updateContextDisplay();

  // Signal ready to host using the SDK
  bridge.ready();

  // Call the handler
  callHandler();
});
