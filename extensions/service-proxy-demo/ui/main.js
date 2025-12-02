const ENVELOPE_VERSION = '1';
const app = document.getElementById('app');
const ticketSection = document.getElementById('ticket-content');
const loadingEl = document.getElementById('loading');
const refreshBtn = document.getElementById('refresh-btn');

const params = new URLSearchParams(window.location.search);
const extensionId = params.get('extensionId') || '';
const tenantId = params.get('tenant') || '';
const defaultLimit = 10;
const hostOrigin = resolveHostOrigin();

let bootstrapSession = null;
let lastError = null;

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
    // cross-origin access throws; swallow and fallback
  }
  return window.location.origin;
}

function buildProxyUrl(id) {
  const base = hostOrigin || window.location.origin;
  const path = `/api/ext-proxy/${encodeURIComponent(id)}/tickets/list`;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

function postReady(requestId) {
  window.parent?.postMessage(
    {
      alga: true,
      version: ENVELOPE_VERSION,
      type: 'ready',
      request_id: requestId,
      payload: {},
    },
    '*'
  );
}

function renderTickets(tickets) {
  ticketSection.innerHTML = '';
  if (!tickets || tickets.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No open tickets 🎉';
    ticketSection.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th scope="col">Ticket</th>
      <th scope="col">Title</th>
      <th scope="col">Status</th>
      <th scope="col">Assignee</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  tickets.forEach((ticket) => {
    const tr = document.createElement('tr');
    const status = (ticket.status || '').toLowerCase();
    const assignee = ticket.assignee || 'Unassigned';
    tr.innerHTML = `
      <th scope="row">${ticket.id}</th>
      <td>${ticket.title ?? '—'}</td>
      <td><span class="status-pill" data-status="${status}">${status || 'unknown'}</span></td>
      <td class="pill-muted">${assignee}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  ticketSection.appendChild(table);
}

function renderError(message) {
  ticketSection.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.innerHTML = `
    <strong>Unable to load tickets.</strong>
    <div>${message}</div>
  `;
  ticketSection.appendChild(div);
}

function setLoading(isLoading) {
  if (isLoading) {
    loadingEl.dataset.state = 'loading';
    loadingEl.textContent = 'Loading ticket list…';
    if (!ticketSection.contains(loadingEl)) {
      ticketSection.appendChild(loadingEl);
    }
  } else {
    loadingEl.dataset.state = 'idle';
    if (ticketSection.contains(loadingEl)) {
      ticketSection.removeChild(loadingEl);
    }
  }
}

async function fetchTickets(limit = defaultLimit) {
  if (!extensionId) {
    renderError('Missing extension context.');
    return;
  }

  setLoading(true);
  lastError = null;

  try {
    const proxyUrl = buildProxyUrl(extensionId);
    const resp = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ limit }),
      credentials: 'include',
    });

    const result = await resp.json();
    if (!resp.ok || !result?.ok) {
      const msg =
        result?.error || `Proxy request failed (${resp.status})`;
      lastError = msg;
      renderError(msg);
    } else {
      renderTickets(result.tickets || []);
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    renderError(lastError);
  } finally {
    setLoading(false);
    reportResize();
  }
}

function reportResize() {
  const height = app.getBoundingClientRect().height;
  window.parent?.postMessage(
    {
      alga: true,
      version: ENVELOPE_VERSION,
      type: 'resize',
      payload: { height },
    },
    '*'
  );
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.alga !== true || data.version !== ENVELOPE_VERSION) return;

  if (data.type === 'bootstrap') {
    bootstrapSession = data.payload?.session ?? null;
    // Use session token for future requests if required
    if (bootstrapSession?.token) {
      window.sessionStorage.setItem('alga-ext-session-token', bootstrapSession.token);
    }
    fetchTickets();
  }
});

refreshBtn.addEventListener('click', () => {
  fetchTickets();
});

window.addEventListener('load', () => {
  postReady();
  fetchTickets();
});

// Periodically report size changes (for dynamic content)
const resizeObserver = new ResizeObserver(() => reportResize());
resizeObserver.observe(app);
