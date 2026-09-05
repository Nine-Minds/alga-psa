// Local fake-provider for the QuickBooks Online and Xero accounting
// integrations. Completes the app's REAL OAuth callback + token exchange +
// disconnect lifecycle without any vendor account:
//
//   - QBO:  authorize, token (code + refresh), token revocation
//   - Xero: authorize (PKCE), token (code + refresh), connections
//           (GET list, DELETE per connection), OAuth grant revocation
//
// The app is pointed here with dev-only env overrides (see the README next to
// this file). It never bypasses app logic: callbacks still run the app's
// state/PKCE/session validation and the disconnect gating under test.
//
// Outcome modes (set per endpoint in the control file; apply on the next
// request — no restart):
//   success    -> normal vendor response
//   transient  -> 503 (retryable)
//   permanent  -> 401 invalid_client (terminal, exposes force-finalize)
//   timeout    -> respond after 30s, after the app's axios timeout fires
//   repeat     -> vendor "already done" idempotent response (invalid_grant /
//                 404), which the app's revoker maps to idempotent success
//
// Per-target overrides (multi-realm / multi-tenant partial results):
//   qbo_revokes:            { "<realmId>": mode }
//   xero_delete_connections:{ "<connectionId>": mode }
//
// Usage:
//   node tools/smoke-sim/accounting-provider-simulator.cjs [port]
//
// Control API (same port):
//   GET  /control         -> current control JSON
//   POST /control         -> merge { ... } into control (JSON body)
//   DELETE /control       -> reset control to defaults and clear runtime state
//
// Env:
//   ALGA_ACCOUNTING_SIM_PORT      port (default 4901)
//   ALGA_ACCOUNTING_SIM_CONTROL   control file path (default /tmp/alga-accounting-sim-control.json)
//   ALGA_ACCOUNTING_SIM_CALLS     request log path (default /tmp/alga-accounting-sim-calls.jsonl)

const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');

const PORT = Number(process.env.ALGA_ACCOUNTING_SIM_PORT || process.argv[2] || 4901);
const CONTROL_PATH = process.env.ALGA_ACCOUNTING_SIM_CONTROL || '/tmp/alga-accounting-sim-control.json';
const CALLS_PATH = process.env.ALGA_ACCOUNTING_SIM_CALLS || '/tmp/alga-accounting-sim-calls.jsonl';

const DEFAULT_CONNECTIONS = [
  {
    id: 'smoke-conn-a',
    tenantId: 'smoke-tenant-a',
    tenantName: 'Smoke Org A',
    tenantType: 'ORGANISATION',
    createdDateUtc: '2026-01-01T00:00:00.000Z',
    updatedDateUtc: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'smoke-conn-b',
    tenantId: 'smoke-tenant-b',
    tenantName: 'Smoke Org B',
    tenantType: 'ORGANISATION',
    createdDateUtc: '2026-01-01T00:00:00.000Z',
    updatedDateUtc: '2026-01-01T00:00:00.000Z',
  },
];

// How long a `timeout`-mode request holds the socket open before answering.
// Defaults to 30s so the app's axios timeouts (10–15s) fire first.
const TIMEOUT_HOLD_MS = 30_000;

function defaultControl() {
  return {
    qbo_authorize: 'success',
    qbo_token_exchange: 'success',
    qbo_revoke: 'success',
    qbo_revokes: {},
    qbo_realm_id: 'smoke-realm-a',
    xero_authorize: 'success',
    xero_token_exchange: 'success',
    xero_connections_list: 'success',
    xero_connections: DEFAULT_CONNECTIONS,
    xero_delete_connection: 'success',
    xero_delete_connections: {},
    xero_revoke_grant: 'success',
    timeout_ms: TIMEOUT_HOLD_MS,
  };
}

// ── Runtime state (auth codes, token→target bindings, revoked marks) ────────
const state = {
  // code -> { provider, clientId, redirectUri, realmId | codeChallenge }
  authCodes: new Map(),
  // refreshToken -> { provider, realmId | connectionId }
  tokenBindings: new Map(),
  revokedRefreshTokens: new Set(),
  revokedConnections: new Set(),
  revokedGrants: new Set(),
};

function resetState() {
  state.authCodes.clear();
  state.tokenBindings.clear();
  state.revokedRefreshTokens.clear();
  state.revokedConnections.clear();
  state.revokedGrants.clear();
}

function readControl() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONTROL_PATH, 'utf8'));
    return { ...defaultControl(), ...parsed };
  } catch {
    return defaultControl();
  }
}

function writeControl(control) {
  fs.writeFileSync(CONTROL_PATH, JSON.stringify(control, null, 2));
}

function log(operation, detail = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), operation, ...detail });
  fs.appendFileSync(CALLS_PATH, line + '\n');
  console.log(line);
}

// ── Small response helpers ───────────────────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

// ── Fault injection ──────────────────────────────────────────────────────────
// Returns true when the fault mode handled the request (caller must return),
// false when the endpoint should proceed with its normal success response.
function faultFor(mode, res, idempotentRepeat, holdMs = TIMEOUT_HOLD_MS) {
  if (mode === 'transient') {
    json(res, 503, { error: 'temporarily_unavailable' });
    return true;
  }
  if (mode === 'permanent') {
    json(res, 401, { error: 'invalid_client' });
    return true;
  }
  if (mode === 'repeat') {
    idempotentRepeat(res);
    return true;
  }
  if (mode === 'timeout') {
    // Outlast the app's axios timeout (10–15s) so the app classifies it as a
    // transient timeout. The delayed completion then answers harmlessly.
    setTimeout(() => json(res, 200, {}), holdMs);
    return true;
  }
  return false;
}

function idempotentInvalidGrant(res) {
  return json(res, 400, { error: 'invalid_grant' });
}

function idempotentNotFound(res) {
  return json(res, 404, { error: 'not_found' });
}

// ── Request body parsing ─────────────────────────────────────────────────────
function readBody(req, cb) {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => cb(raw));
}

function parseForm(raw) {
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function parseBasicAuth(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return { clientId: '', clientSecret: '' };
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
}

function newToken(prefix) {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

function base64UrlSha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ── Handlers ─────────────────────────────────────────────────────────────────

function handleQboAuthorize(req, res, control, url) {
  const redirectUri = String(url.searchParams.get('redirect_uri') || '');
  const stateParam = String(url.searchParams.get('state') || '');
  const clientId = String(url.searchParams.get('client_id') || '');
  if (!redirectUri || !stateParam) {
    log('qbo_authorize', { status: 400 });
    return json(res, 400, { error: 'client_id and redirect_uri are required' });
  }
  const respond = () => {
    if (control.qbo_authorize === 'permanent') {
      const callback = new URL(redirectUri);
      callback.searchParams.set('error', 'access_denied');
      log('qbo_authorize', { mode: 'permanent', status: 302 });
      return redirect(res, callback.toString());
    }
    const code = newToken('qbo-code');
    state.authCodes.set(code, { provider: 'qbo', clientId, redirectUri, realmId: String(control.qbo_realm_id) });
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', stateParam);
    callback.searchParams.set('realmId', String(control.qbo_realm_id));
    log('qbo_authorize', { mode: 'success', statePresent: true, status: 302 });
    redirect(res, callback.toString());
  };
  if (control.qbo_authorize === 'timeout') {
    // Delay the redirect past the app's expectations so a tester can start a
    // disconnect while the browser still holds the (valid) OAuth state cookie.
    log('qbo_authorize', { mode: 'timeout', statePresent: true });
    setTimeout(respond, Number(control.timeout_ms) || TIMEOUT_HOLD_MS);
    return;
  }
  respond();
}

function handleQboToken(req, res, control, body) {
  const params = parseForm(body);
  const { clientId } = parseBasicAuth(req);
  const grantType = params.grant_type;

  if (faultFor(control.qbo_token_exchange, res, idempotentInvalidGrant, Number(control.timeout_ms) || TIMEOUT_HOLD_MS)) {
    log('qbo_token_exchange', { mode: control.qbo_token_exchange, status: 'fault' });
    return;
  }

  if (grantType === 'authorization_code') {
    const record = state.authCodes.get(String(params.code));
    if (!record || record.provider !== 'qbo' || record.clientId !== clientId || record.redirectUri !== String(params.redirect_uri)) {
      log('qbo_token_exchange', { status: 400, reason: 'invalid_grant' });
      return json(res, 400, { error: 'invalid_grant' });
    }
    state.authCodes.delete(String(params.code));
    const accessToken = newToken('qbo-access');
    const refreshToken = newToken('qbo-refresh');
    state.tokenBindings.set(refreshToken, { provider: 'qbo', realmId: record.realmId });
    log('qbo_token_exchange', { mode: 'success', realmId: record.realmId });
    return json(res, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      x_refresh_token_expires_in: 8_640_000,
      token_type: 'bearer',
    });
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(params.refresh_token);
    const binding = state.tokenBindings.get(refreshToken);
    if (!binding || state.revokedRefreshTokens.has(refreshToken) || binding.provider !== 'qbo') {
      log('qbo_token_exchange', { status: 400, reason: 'invalid_grant' });
      return json(res, 400, { error: 'invalid_grant' });
    }
    state.tokenBindings.delete(refreshToken);
    const accessToken = newToken('qbo-access');
    const nextRefresh = newToken('qbo-refresh');
    state.tokenBindings.set(nextRefresh, { provider: 'qbo', realmId: binding.realmId });
    log('qbo_token_exchange', { mode: 'success', grant: 'refresh', realmId: binding.realmId });
    return json(res, 200, {
      access_token: accessToken,
      refresh_token: nextRefresh,
      expires_in: 3600,
      x_refresh_token_expires_in: 8_640_000,
      token_type: 'bearer',
    });
  }

  log('qbo_token_exchange', { status: 400, reason: 'unsupported_grant_type' });
  json(res, 400, { error: 'unsupported_grant_type' });
}

function handleQboRevoke(req, res, control, body) {
  let token = '';
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
    token = parseForm(body).token;
  } else {
    try {
      token = JSON.parse(body || '{}').token;
    } catch {
      token = '';
    }
  }
  const binding = state.tokenBindings.get(token);
  const realmId = binding?.realmId ?? 'unknown';
  const mode = control.qbo_revokes?.[realmId] ?? control.qbo_revoke;

  if (faultFor(mode, res, idempotentInvalidGrant, Number(control.timeout_ms) || TIMEOUT_HOLD_MS)) {
    log('qbo_revoke', { mode, realmId, status: 'fault' });
    return;
  }
  if (state.revokedRefreshTokens.has(token)) {
    // Revoking an already-revoked grant is idempotent success to the app.
    log('qbo_revoke', { mode: 'repeat', realmId, status: 400, reason: 'already_revoked' });
    return idempotentInvalidGrant(res);
  }
  if (token) state.revokedRefreshTokens.add(token);
  log('qbo_revoke', { mode: 'success', realmId });
  json(res, 200, {});
}

// ── QBO v3 company API (minimal surface for connection-status validation) ────

function handleQboCompanyInfo(req, res, realmId) {
  log('qbo_companyinfo', { realmId });
  json(res, 200, {
    CompanyInfo: {
      Id: realmId,
      CompanyName: 'Alga Emulated Co',
      Country: 'US',
      CompanyStartDate: '2020-01-01',
    },
  });
}

function handleQboQuery(req, res, realmId, url) {
  const query = String(url.searchParams.get('query') || '');
  if (/FROM\s+CompanyInfo/i.test(query)) {
    log('qbo_query', { realmId, kind: 'companyinfo' });
    return json(res, 200, {
      QueryResponse: {
        CompanyInfo: [
          { Id: realmId, CompanyName: 'Alga Emulated Co', Country: 'US', CompanyStartDate: '2020-01-01' },
        ],
      },
    });
  }
  log('qbo_query', { realmId, kind: 'empty' });
  json(res, 200, { QueryResponse: {} });
}

function handleXeroAuthorize(req, res, control, url) {
  const redirectUri = String(url.searchParams.get('redirect_uri') || '');
  const stateParam = String(url.searchParams.get('state') || '');
  const codeChallenge = String(url.searchParams.get('code_challenge') || '');
  if (!redirectUri || !stateParam) {
    log('xero_authorize', { status: 400 });
    return json(res, 400, { error: 'redirect_uri and state are required' });
  }
  const respond = () => {
    if (control.xero_authorize === 'permanent') {
      const callback = new URL(redirectUri);
      callback.searchParams.set('error', 'access_denied');
      log('xero_authorize', { mode: 'permanent', status: 302 });
      return redirect(res, callback.toString());
    }
    const code = newToken('xero-code');
    state.authCodes.set(code, { provider: 'xero', clientId: String(url.searchParams.get('client_id') || ''), redirectUri, codeChallenge });
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', stateParam);
    log('xero_authorize', { mode: 'success', pkceChallenge: Boolean(codeChallenge), status: 302 });
    redirect(res, callback.toString());
  };
  if (control.xero_authorize === 'timeout') {
    log('xero_authorize', { mode: 'timeout', statePresent: true });
    setTimeout(respond, Number(control.timeout_ms) || TIMEOUT_HOLD_MS);
    return;
  }
  respond();
}

function handleXeroToken(req, res, control, body) {
  const params = parseForm(body);
  const grantType = params.grant_type;

  if (faultFor(control.xero_token_exchange, res, idempotentInvalidGrant, Number(control.timeout_ms) || TIMEOUT_HOLD_MS)) {
    log('xero_token_exchange', { mode: control.xero_token_exchange, status: 'fault' });
    return;
  }

  if (grantType === 'authorization_code') {
    const record = state.authCodes.get(String(params.code));
    const verifierMatches =
      record && record.provider === 'xero' &&
      (!record.codeChallenge || base64UrlSha256(String(params.code_verifier)) === record.codeChallenge);
    if (!record || record.provider !== 'xero' || !verifierMatches || record.redirectUri !== String(params.redirect_uri)) {
      log('xero_token_exchange', { status: 400, reason: 'invalid_grant' });
      return json(res, 400, { error: 'invalid_grant' });
    }
    state.authCodes.delete(String(params.code));
    const accessToken = newToken('xero-access');
    const refreshToken = newToken('xero-refresh');
    state.tokenBindings.set(refreshToken, { provider: 'xero', connectionId: null });
    log('xero_token_exchange', { mode: 'success', pkceVerified: verifierMatches });
    return json(res, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 1800,
      refresh_token_expires_in: 7_776_000,
      token_type: 'Bearer',
      scope: 'offline_access accounting.settings accounting.invoices accounting.banktransactions accounting.payments accounting.contacts',
    });
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(params.refresh_token);
    const binding = state.tokenBindings.get(refreshToken);
    if (!binding || state.revokedRefreshTokens.has(refreshToken) || binding.provider !== 'xero') {
      log('xero_token_exchange', { status: 400, reason: 'invalid_grant' });
      return json(res, 400, { error: 'invalid_grant' });
    }
    state.tokenBindings.delete(refreshToken);
    const accessToken = newToken('xero-access');
    const nextRefresh = newToken('xero-refresh');
    state.tokenBindings.set(nextRefresh, { provider: 'xero', connectionId: binding.connectionId });
    log('xero_token_exchange', { mode: 'success', grant: 'refresh' });
    return json(res, 200, {
      access_token: accessToken,
      refresh_token: nextRefresh,
      expires_in: 1800,
      refresh_token_expires_in: 7_776_000,
      token_type: 'Bearer',
      scope: 'offline_access accounting.settings accounting.invoices accounting.banktransactions accounting.payments accounting.contacts',
    });
  }

  log('xero_token_exchange', { status: 400, reason: 'unsupported_grant_type' });
  json(res, 400, { error: 'unsupported_grant_type' });
}

function handleXeroConnectionsList(req, res, control) {
  if (faultFor(control.xero_connections_list, res, idempotentInvalidGrant, Number(control.timeout_ms) || TIMEOUT_HOLD_MS)) {
    log('xero_connections_list', { mode: control.xero_connections_list, status: 'fault' });
    return;
  }
  const connections = Array.isArray(control.xero_connections) ? control.xero_connections : [];
  log('xero_connections_list', { mode: 'success', count: connections.length });
  json(res, 200, connections);
}

function handleXeroDeleteConnection(req, res, control, connectionId) {
  const mode = control.xero_delete_connections?.[connectionId] ?? control.xero_delete_connection;

  if (faultFor(mode, res, idempotentNotFound, Number(control.timeout_ms) || TIMEOUT_HOLD_MS)) {
    log('xero_delete_connection', { mode, connectionId, status: 'fault' });
    return;
  }
  if (state.revokedConnections.has(connectionId)) {
    // Deleting an already-deleted connection is idempotent success (404).
    log('xero_delete_connection', { mode: 'repeat', connectionId, status: 404, reason: 'already_deleted' });
    return idempotentNotFound(res);
  }
  state.revokedConnections.add(connectionId);
  log('xero_delete_connection', { mode: 'success', connectionId });
  noContent(res);
}

function handleXeroRevokeGrant(req, res, control, body) {
  const token = parseForm(body).token || '';
  const mode = control.xero_revoke_grant;

  if (faultFor(mode, res, idempotentInvalidGrant, Number(control.timeout_ms) || TIMEOUT_HOLD_MS)) {
    log('xero_revoke_grant', { mode, status: 'fault' });
    return;
  }
  if (state.revokedGrants.has(token)) {
    log('xero_revoke_grant', { mode: 'repeat', status: 400, reason: 'already_revoked' });
    return idempotentInvalidGrant(res);
  }
  if (token) state.revokedGrants.add(token);
  log('xero_revoke_grant', { mode: 'success' });
  json(res, 200, {});
}

// ── Router ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const control = readControl();

  // Control API.
  if (path === '/control') {
    if (req.method === 'GET') {
      return json(res, 200, control);
    }
    if (req.method === 'POST') {
      return readBody(req, (raw) => {
        try {
          const patch = JSON.parse(raw || '{}');
          writeControl({ ...control, ...patch });
          log('control_set', { patch: Object.keys(patch) });
          return json(res, 200, readControl());
        } catch {
          return json(res, 400, { error: 'invalid json' });
        }
      });
    }
    if (req.method === 'DELETE') {
      writeControl(defaultControl());
      resetState();
      log('control_reset');
      return json(res, 200, readControl());
    }
  }
  if (path === '/health') {
    return json(res, 200, { ok: true });
  }

  // QBO.
  if (path === '/qbo/connect/oauth2' && req.method === 'GET') return handleQboAuthorize(req, res, control, url);
  if (path === '/qbo/oauth2/v1/tokens/bearer' && req.method === 'POST') {
    return readBody(req, (body) => handleQboToken(req, res, control, body));
  }
  if (path === '/qbo/oauth2/v1/revoke' && req.method === 'POST') {
    return readBody(req, (body) => handleQboRevoke(req, res, control, body));
  }
  const qboCompanyMatch = path.match(/^\/qbo\/v3\/company\/([^/]+)\/companyinfo\/([^/]+)$/);
  if (qboCompanyMatch && req.method === 'GET') return handleQboCompanyInfo(req, res, decodeURIComponent(qboCompanyMatch[1]));
  const qboQueryMatch = path.match(/^\/qbo\/v3\/company\/([^/]+)\/query$/);
  if (qboQueryMatch && req.method === 'GET') return handleQboQuery(req, res, decodeURIComponent(qboQueryMatch[1]), url);

  // Xero.
  if (path === '/xero/connect/authorize' && req.method === 'GET') return handleXeroAuthorize(req, res, control, url);
  if (path === '/xero/connect/token' && req.method === 'POST') {
    return readBody(req, (body) => handleXeroToken(req, res, control, body));
  }
  if (path === '/xero/connections' && req.method === 'GET') return handleXeroConnectionsList(req, res, control);
  if (path.startsWith('/xero/connections/') && req.method === 'DELETE') {
    return handleXeroDeleteConnection(req, res, control, decodeURIComponent(path.slice('/xero/connections/'.length)));
  }
  if (path === '/xero/connect/revocation' && req.method === 'POST') {
    return readBody(req, (body) => handleXeroRevokeGrant(req, res, control, body));
  }

  json(res, 404, { error: 'not found', path });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`accounting provider simulator listening on http://127.0.0.1:${PORT}`);
  console.log(`control file: ${CONTROL_PATH}`);
  console.log(`call log:     ${CALLS_PATH}`);
  console.log('control API:  GET /control, POST /control (merge JSON), DELETE /control (reset)');
});
