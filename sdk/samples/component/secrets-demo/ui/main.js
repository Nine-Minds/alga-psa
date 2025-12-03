const ENVELOPE_VERSION = '1';
const output = document.getElementById('output');

/**
 * Resolve the main application's origin (host domain).
 * Since the extension UI runs in an iframe on a separate domain (e.g., ext-abc.apps.algapsa.com),
 * we need to detect the parent frame's domain to make API calls to the main app.
 */
function resolveHostOrigin() {
  // Try to get parent frame's origin from referrer header
  const referrer = document.referrer;
  if (referrer) {
    try {
      return new URL(referrer).origin;
    } catch {
      // ignore invalid referrer
    }
  }

  // Try to access parent frame's location (works if same-origin)
  try {
    if (window.parent && window.parent !== window && window.parent.location) {
      return window.parent.location.origin;
    }
  } catch {
    // cross-origin access throws; swallow and fallback
  }

  // Fallback to current window's origin (last resort)
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

function renderSecret(secretName, secretValue) {
  const div = document.createElement('div');
  div.innerHTML = `
    <p><strong>${secretName}</strong></p>
    <div class="secret">${secretValue}</div>
  `;
  output.appendChild(div);
}

function renderError(message) {
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = `Error: ${message}`;
  output.appendChild(div);
}

function signalReady(requestId = '') {
  // Signal ready to host using Alga envelope protocol
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        alga: true,
        version: ENVELOPE_VERSION,
        type: 'ready',
        request_id: requestId,
        payload: {}
      },
      '*' // In production, this should be the specific parent origin
    );
  }
}

function reportResize() {
  const height = output.getBoundingClientRect().height;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        alga: true,
        version: ENVELOPE_VERSION,
        type: 'resize',
        payload: { height }
      },
      '*'
    );
  }
}

async function fetchAndDisplaySecret() {
  try {
    // Get extension context from URL parameters
    const params = new URLSearchParams(window.location.search);
    const extensionId = resolveExtensionId(params);
    const tenantId = params.get('tenant') || 'Not available';

    if (!extensionId) {
      renderError(
        'Missing extension context. Ensure the iframe URL includes ?extensionId=<registry-id>.'
      );
      reportResize();
      return;
    }

    // Display context info
    renderSecret('Tenant ID', tenantId);
    renderSecret('Extension ID', extensionId);

    // Make a request to the API gateway which triggers /v1/execute
    // This calls the handler via the runner
    const hostOrigin = resolveHostOrigin();
    const apiUrl = new URL(`/api/ext/${extensionId}/`, hostOrigin).toString();

    console.log(`Making request to ${apiUrl} to trigger handler execution...`);
    const response = await fetch(apiUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      renderError(
        `API Gateway returned ${response.status} with non-JSON payload: ${text.slice(0, 160)}`
      );
      reportResize();
      return;
    }

    if (!response.ok) {
      const detail = data?.error || data?.message || data?.detail || response.statusText;
      renderError(`API Gateway returned status ${response.status}: ${detail}`);
      console.warn('Secrets demo gateway error', { status: response.status, detail, data });
      reportResize();
      return;
    }

    // Display the results from the handler
    renderSecret('Message (from secret)', data.message || 'No message');
    renderSecret('Handler Response Path', data.path || '/');

    // Show config if present
    if (data.config && Object.keys(data.config).length > 0) {
      renderSecret('Install Config', JSON.stringify(data.config, null, 2));
    }

    renderSecret('Handler Status', '✓ Successfully executed via /v1/execute');
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown failure';
    renderError(message || 'Failed to trigger handler execution');
    console.error('Secrets demo request error', err);
  }

  reportResize();
}

// Listen for bootstrap message from parent (optional, for session token if needed)
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.alga !== true || data.version !== ENVELOPE_VERSION) return;

  if (data.type === 'bootstrap') {
    // Store session token if provided
    if (data.payload?.session?.token) {
      window.sessionStorage.setItem('alga-ext-session-token', data.payload.session.token);
    }
    // Optionally fetch data after bootstrap
    // fetchAndDisplaySecret();
  }
});

// Signal ready when page loads
window.addEventListener('load', () => {
  signalReady();
  fetchAndDisplaySecret();
});

// Periodically report size changes (for dynamic content)
const resizeObserver = new ResizeObserver(() => reportResize());
resizeObserver.observe(output);
