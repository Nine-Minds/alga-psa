#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { collectStatusSnapshotAsync } from './status-engine.mjs';
import { createKubectlQueue } from './kubectl-queue.mjs';
import { persistSetupInputs, validateSetupInputs, runNetworkChecks } from './setup-engine.mjs';
import { generateSupportBundle } from './support-bundle.mjs';
import { runAppChannelUpdate } from './update-engine.mjs';
import {
  authPhase,
  isAuthenticated,
  getCredentialState,
  tokensMatch,
  setPassword,
  verifyPassword,
  sessionCookieHeader,
  clearSessionCookieHeader,
  checkLockout,
  registerFailure,
  registerSuccess,
} from './auth.mjs';

const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);
const stateFile = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';
const setupInputsFile = process.env.ALGA_APPLIANCE_SETUP_INPUTS_FILE || '/etc/alga-appliance/setup-inputs.json';
const releaseSelectionFile = process.env.ALGA_APPLIANCE_RELEASE_SELECTION_FILE || '/etc/alga-appliance/release-selection.json';
const kubeconfigPath = process.env.ALGA_APPLIANCE_KUBECONFIG || '/etc/rancher/k3s/k3s.yaml';
const staticUiDir = process.env.ALGA_APPLIANCE_STATUS_UI_DIR || '/opt/alga-appliance/status-ui/dist';
const STATUS_CACHE_TTL_MS = Number(process.env.ALGA_APPLIANCE_STATUS_CACHE_TTL_MS || 10_000);
const KUBECTL_REQUEST_TIMEOUT_MS = Number(process.env.ALGA_APPLIANCE_KUBECTL_REQUEST_TIMEOUT_MS || 20_000);
const KUBECTL_STATUS_TIMEOUT_MS = Number(process.env.ALGA_APPLIANCE_KUBECTL_STATUS_TIMEOUT_MS || 20_000);
const KUBECTL_API_TIMEOUT_MS = Number(process.env.ALGA_APPLIANCE_KUBECTL_API_TIMEOUT_MS || 30_000);
const KUBECTL_LOG_TIMEOUT_MS = Number(process.env.ALGA_APPLIANCE_KUBECTL_LOG_TIMEOUT_MS || 60_000);
const NETWORK_PROBE_TTL_MS = Number(process.env.ALGA_APPLIANCE_NETWORK_PROBE_TTL_MS || 20_000);
const NETWORK_PROBE_FAILURE_DEBOUNCE = Number(process.env.ALGA_APPLIANCE_NETWORK_PROBE_DEBOUNCE || 2);
const kubectlQueue = createKubectlQueue({ name: 'host-service-kubectl' });
let cachedStatusSnapshot = null;
let cachedStatusSnapshotAt = 0;
let cachedNetworkProbe = null;
let cachedNetworkProbeAt = 0;
let networkProbeConsecutiveFailures = 0;
let networkProbeInFlight = null;

function readInstallStateSafe() {
  try {
    return fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  } catch {
    return null;
  }
}

// Only spend outbound network egress on the live probe when a network-class
// outcome is actually relevant: during early install phases or when a
// network/dns/github failure is recorded. A healthy, progressed install does
// not get probed.
function networkProbeRelevant(installState) {
  if (!installState) return false;
  const phase = String(installState.phase || '').toLowerCase();
  const failurePhase = String(installState.failure?.phase || '').toLowerCase();
  const earlyPhases = ['setup', 'dns', 'network', 'registry-release-source', 'release'];
  return earlyPhases.includes(phase) || ['network', 'dns', 'registry-release-source'].includes(failurePhase);
}

function networkProbeInputs() {
  let inputs = {};
  try {
    if (fs.existsSync(setupInputsFile)) inputs = JSON.parse(fs.readFileSync(setupInputsFile, 'utf8'));
  } catch {
    inputs = {};
  }
  return {
    channel: inputs.channel || 'stable',
    dnsMode: inputs.dnsMode || 'system',
    dnsServers: inputs.dnsServers || '',
    releaseRef: inputs.releaseRef || ''
  };
}

// Cached + debounced live network probe. The TTL bounds egress regardless of
// poll rate; the debounce requires consecutive failures before flipping a
// previously-healthy result to failing, to avoid flapping the UI on a blip.
async function getNetworkProbe() {
  const now = Date.now();
  if (cachedNetworkProbe && now - cachedNetworkProbeAt < NETWORK_PROBE_TTL_MS) return cachedNetworkProbe;
  if (networkProbeInFlight) return networkProbeInFlight;

  networkProbeInFlight = (async () => {
    let raw;
    try {
      raw = await runNetworkChecks(networkProbeInputs(), { timeoutMs: 8_000 });
    } catch (error) {
      raw = {
        ok: false,
        checkedAt: new Date().toISOString(),
        failure: {
          phase: 'network',
          step: 'network-probe',
          message: 'Live network probe failed to run.',
          suspectedCause: 'Live network probe failed to run.',
          suggestedNextStep: error instanceof Error ? error.message : String(error),
          retrySafe: true
        }
      };
    }

    networkProbeConsecutiveFailures = raw.ok ? 0 : networkProbeConsecutiveFailures + 1;
    const debounced = !raw.ok && cachedNetworkProbe?.ok && networkProbeConsecutiveFailures < NETWORK_PROBE_FAILURE_DEBOUNCE;
    const reported = debounced
      ? { ok: true, checkedAt: raw.checkedAt, failure: null }
      : raw;

    cachedNetworkProbe = reported;
    cachedNetworkProbeAt = Date.now();
    networkProbeInFlight = null;
    return reported;
  })();

  return networkProbeInFlight;
}

// --- Self-healing reconcile loop -------------------------------------------
// The setup workflow is fire-once: on a failure it records a blocked state and
// exits. Rather than asking an operator to manually re-run setup (the inputs
// are already persisted), the control plane re-runs the workflow on its own for
// retry-safe blocked states, with exponential backoff and an attempt cap.
// Network-class blockers are only retried once the live probe is healthy again,
// so a real outage waits instead of hammering.
const AUTO_RETRY_DISABLED = process.env.ALGA_APPLIANCE_DISABLE_AUTO_RETRY === '1'
  || process.env.ALGA_APPLIANCE_DISABLE_SETUP_QUEUE === '1';
const AUTO_RETRY_MAX_ATTEMPTS = Number(process.env.ALGA_APPLIANCE_AUTO_RETRY_MAX_ATTEMPTS || 10);
const AUTO_RETRY_BASE_MS = Number(process.env.ALGA_APPLIANCE_AUTO_RETRY_BASE_MS || 15_000);
const AUTO_RETRY_MAX_MS = Number(process.env.ALGA_APPLIANCE_AUTO_RETRY_MAX_MS || 300_000);
const RECONCILE_INTERVAL_MS = Number(process.env.ALGA_APPLIANCE_RECONCILE_INTERVAL_MS || 15_000);
const NETWORK_CLASS_PHASES = ['network', 'dns', 'registry-release-source'];
const retryStateFile = path.join(path.dirname(stateFile), 'auto-retry-state.json');
let reconcileRunning = false;

function installStateBlocked(state) {
  return Boolean(state?.failure) && state.failure.retrySafe !== false && String(state.status || '').includes('blocked');
}

function installStateRunning(state) {
  const status = String(state?.status || '');
  return status === 'setup-queued' || status.endsWith('-running');
}

function failureCategory(state) {
  const phase = String(state?.failure?.phase || state?.phase || '').toLowerCase();
  return NETWORK_CLASS_PHASES.find((candidate) => phase.includes(candidate)) || phase;
}

function backoffMs(attempts) {
  return Math.min(AUTO_RETRY_MAX_MS, AUTO_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

function readRetryState() {
  try {
    return fs.existsSync(retryStateFile) ? JSON.parse(fs.readFileSync(retryStateFile, 'utf8')) : {};
  } catch {
    return {};
  }
}

function writeRetryState(value) {
  try {
    fs.mkdirSync(path.dirname(retryStateFile), { recursive: true });
    fs.writeFileSync(retryStateFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  } catch { /* best effort */ }
}

function clearRetryState() {
  try {
    if (fs.existsSync(retryStateFile)) fs.unlinkSync(retryStateFile);
  } catch { /* best effort */ }
}

// Summary used by the status snapshot so the UI shows "retrying automatically"
// instead of a dead-end "re-run setup" instruction.
function computeAutoRetrySummary(state) {
  if (AUTO_RETRY_DISABLED || !installStateBlocked(state)) return undefined;
  const retry = readRetryState();
  const attempts = Number(retry.attempts || 0);
  if (attempts >= AUTO_RETRY_MAX_ATTEMPTS) {
    return { willRetry: false, exhausted: true, attempts, maxAttempts: AUTO_RETRY_MAX_ATTEMPTS };
  }
  const nextAttemptInSeconds = retry.nextAttemptAt ? Math.max(0, Math.round((retry.nextAttemptAt - Date.now()) / 1000)) : 0;
  return { willRetry: true, exhausted: false, attempts, maxAttempts: AUTO_RETRY_MAX_ATTEMPTS, nextAttemptInSeconds };
}

async function reconcileBlockedSetup() {
  if (AUTO_RETRY_DISABLED || reconcileRunning) return;
  reconcileRunning = true;
  try {
    const state = readInstallStateSafe();
    if (!state || !installStateBlocked(state)) {
      clearRetryState();
      return;
    }
    if (installStateRunning(state)) return;

    const retry = readRetryState();
    const attempts = Number(retry.attempts || 0);
    if (attempts >= AUTO_RETRY_MAX_ATTEMPTS) return; // exhausted; leave for manual action
    const now = Date.now();
    if (retry.nextAttemptAt && now < retry.nextAttemptAt) return; // still in backoff window

    if (NETWORK_CLASS_PHASES.includes(failureCategory(state))) {
      const probe = await getNetworkProbe();
      if (!probe.ok) {
        writeRetryState({ attempts, nextAttemptAt: now + backoffMs(attempts || 1), lastReason: 'network still unhealthy' });
        return;
      }
    }

    const nextAttempts = attempts + 1;
    writeRetryState({ attempts: nextAttempts, lastAttemptAt: new Date(now).toISOString(), nextAttemptAt: now + backoffMs(nextAttempts) });
    queueSetupWorkflow();
  } finally {
    reconcileRunning = false;
  }
}

function currentMode() {
  if (!fs.existsSync(stateFile)) {
    return 'setup';
  }

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state && typeof state === 'object' && typeof state.status === 'string' && state.status.length > 0) {
      return 'status';
    }
    return 'setup';
  } catch {
    return 'setup';
  }
}

// True when setup is blocked on an operator-correctable input — specifically a
// bad/expired/used install code (failure.step === 'redeem-install-code'). In
// that state we keep GET /setup and POST /api/setup OPEN so the operator can
// re-enter a re-issued code, instead of permanently locking them into the
// status view. Any other submitted state stays locked (status mode) as before.
function setupReEditable() {
  try {
    if (!fs.existsSync(stateFile)) return false;
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return state?.failure?.step === 'redeem-install-code';
  } catch {
    return false;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPreBlock(title, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `<details open><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(text || '(empty)')}</pre></details>`;
}

function jsonResponse(res, statusCode, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function jsonResponseWithCookie(res, statusCode, value, cookie) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(statusCode, { 'content-type': 'application/json', 'set-cookie': cookie });
  res.end(JSON.stringify(value));
}

// Every data-bearing endpoint now requires a valid session cookie instead of a
// `?token=` query parameter. The token is only used once, at the PIN screen, to
// bootstrap the management password.
function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  jsonResponse(res, 401, { error: 'Unauthorized: sign in to continue.' });
  return false;
}

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    try { return JSON.parse(body || '{}'); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function passwordPolicyError(value) {
  if (typeof value !== 'string' || value.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(value)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Include an uppercase letter.';
  if (!/\d/.test(value)) return 'Include a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) return 'Include a special character.';
  return null;
}

function requestAbortSignal(req, res) {
  const controller = new AbortController();
  const abortIfUnfinished = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.on('aborted', abortIfUnfinished);
  res.on('close', abortIfUnfinished);
  return controller.signal;
}

function contentTypeFor(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function safeStaticFileForPathname(pathname) {
  if (!fs.existsSync(staticUiDir)) return null;
  const normalized = path.posix.normalize(decodeURIComponent(pathname));

  const candidates = [];
  if (normalized === '/') {
    candidates.push(path.join(staticUiDir, 'index.html'));
  } else if (normalized === '/setup' || normalized === '/setup/') {
    candidates.push(path.join(staticUiDir, 'setup', 'index.html'));
  } else {
    const relative = normalized.replace(/^\/+/, '');
    candidates.push(path.join(staticUiDir, relative));
    candidates.push(path.join(staticUiDir, relative, 'index.html'));
  }

  const root = path.resolve(staticUiDir);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved.startsWith(root) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }
  return null;
}

function serveStaticFile(res, file) {
  res.writeHead(200, { 'content-type': contentTypeFor(file) });
  fs.createReadStream(file).pipe(res);
}

function defaultAppUrlForRequest(requestHost) {
  let hostname = '';
  try {
    hostname = new URL(`http://${requestHost || ''}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    hostname = '';
  }

  const lower = hostname.toLowerCase();
  if (!hostname || lower === 'localhost' || lower === '::1' || hostname.startsWith('127.')) {
    hostname = systemNetworkSummary().addresses[0] || '';
  }

  if (!hostname) return '';
  const formattedHost = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return `http://${formattedHost}:3000`;
}

function readSetupDefaults(requestHost) {
  const fallback = {
    channel: 'stable',
    appHostname: defaultAppUrlForRequest(requestHost),
    dnsMode: 'system',
    dnsServers: '',
    releaseRef: ''
  };
  if (!fs.existsSync(setupInputsFile)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(setupInputsFile, 'utf8'));
    return { ...fallback, ...parsed, appHostname: parsed.appHostname || fallback.appHostname };
  } catch {
    return fallback;
  }
}

function systemNetworkSummary() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const addr of entries || []) {
      if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
    }
  }
  const resolvers = fs.existsSync('/etc/resolv.conf')
    ? fs.readFileSync('/etc/resolv.conf', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('nameserver '))
      .map((line) => line.replace('nameserver ', '').trim())
    : [];
  return { addresses, resolvers };
}

function queueSetupWorkflow() {
  if (process.env.ALGA_APPLIANCE_DISABLE_SETUP_QUEUE === '1') {
    return;
  }

  const child = spawn(process.execPath, [
    new URL('./setup-engine.mjs', import.meta.url).pathname,
    'run',
    '--setup-inputs', setupInputsFile,
    '--state-file', stateFile,
    '--release-selection-file', releaseSelectionFile,
    '--kubeconfig', kubeconfigPath
  ], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  });
  child.unref();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function kubectlCommand(args, requestTimeoutMs = KUBECTL_REQUEST_TIMEOUT_MS) {
  const requestTimeoutSeconds = Math.max(1, Math.ceil(requestTimeoutMs / 1000));
  return `kubectl --request-timeout=${requestTimeoutSeconds}s --kubeconfig ${shellQuote(kubeconfigPath)} ${args}`;
}

function runQueuedKubectl(command, options = {}) {
  return kubectlQueue.enqueue(command, {
    timeoutMs: options.timeoutMs || KUBECTL_API_TIMEOUT_MS,
    onStart: options.onStart,
    onDone: options.onDone,
    signal: options.signal
  });
}

async function runKubectlJson(args, timeoutMs = KUBECTL_API_TIMEOUT_MS, signal) {
  const result = await runQueuedKubectl(kubectlCommand(`${args} -o json`, timeoutMs), { timeoutMs, signal });
  if (!result.ok) return { ...result, value: null };
  try {
    return { ...result, value: JSON.parse(result.stdout || '{}') };
  } catch (error) {
    return { ...result, ok: false, status: 1, value: null, stderr: error instanceof Error ? error.message : 'Invalid JSON from kubectl.' };
  }
}

function validKubeName(value) {
  return typeof value === 'string' && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

function validContainerName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value);
}

function namespaceFlag(namespace) {
  if (!namespace || namespace === 'all' || namespace === '_all') return '-A';
  if (!validKubeName(namespace)) return null;
  return `-n ${shellQuote(namespace)}`;
}

function summarizeDeployment(item, replicaSets = []) {
  const labels = item.spec?.selector?.matchLabels || {};
  const deploymentName = item.metadata?.name || '';
  const deploymentUid = item.metadata?.uid || '';
  const deploymentNamespace = item.metadata?.namespace || 'default';
  const relatedReplicaSets = replicaSets.filter((rs) => {
    if ((rs.metadata?.namespace || 'default') !== deploymentNamespace) return false;
    const owners = rs.metadata?.ownerReferences || [];
    if (owners.length > 0) {
      return owners.some((owner) => owner.kind === 'Deployment' && (owner.uid === deploymentUid || owner.name === deploymentName));
    }
    const rsLabels = rs.metadata?.labels || {};
    return Object.entries(labels).every(([key, value]) => rsLabels[key] === value);
  });
  return {
    namespace: item.metadata?.namespace || 'default',
    name: item.metadata?.name || 'unknown',
    readyReplicas: item.status?.readyReplicas || 0,
    replicas: item.status?.replicas || item.spec?.replicas || 0,
    updatedReplicas: item.status?.updatedReplicas || 0,
    availableReplicas: item.status?.availableReplicas || 0,
    generation: item.metadata?.generation || 0,
    observedGeneration: item.status?.observedGeneration || 0,
    createdAt: item.metadata?.creationTimestamp || null,
    strategy: item.spec?.strategy?.type || 'Unknown',
    conditions: item.status?.conditions || [],
    images: [...new Set((item.spec?.template?.spec?.containers || []).map((container) => container.image).filter(Boolean))],
    revision: item.metadata?.annotations?.['deployment.kubernetes.io/revision'] || null,
    replicaSets: relatedReplicaSets.map((rs) => ({
      name: rs.metadata?.name || 'unknown',
      revision: rs.metadata?.annotations?.['deployment.kubernetes.io/revision'] || null,
      replicas: rs.status?.replicas || 0,
      readyReplicas: rs.status?.readyReplicas || 0,
      availableReplicas: rs.status?.availableReplicas || 0,
      createdAt: rs.metadata?.creationTimestamp || null,
      images: [...new Set((rs.spec?.template?.spec?.containers || []).map((container) => container.image).filter(Boolean))]
    })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  };
}

function summarizePod(item) {
  const statuses = item.status?.containerStatuses || [];
  return {
    namespace: item.metadata?.namespace || 'default',
    name: item.metadata?.name || 'unknown',
    phase: item.status?.phase || 'Unknown',
    reason: item.status?.reason || null,
    ready: statuses.length > 0 && statuses.every((status) => status.ready),
    readyContainers: statuses.filter((status) => status.ready).length,
    totalContainers: (item.spec?.containers || []).length,
    restarts: statuses.reduce((sum, status) => sum + (status.restartCount || 0), 0),
    node: item.spec?.nodeName || null,
    podIP: item.status?.podIP || null,
    createdAt: item.metadata?.creationTimestamp || null,
    containers: (item.spec?.containers || []).map((container) => ({
      name: container.name,
      image: container.image,
      ready: statuses.find((status) => status.name === container.name)?.ready || false,
      restarts: statuses.find((status) => status.name === container.name)?.restartCount || 0,
      state: statuses.find((status) => status.name === container.name)?.state || null
    }))
  };
}

function tokenHelpHtml() {
  return `<p>The one-time setup token is printed on the VM console and persisted in the login banner. Enter it once to choose a management password; after that you sign in with the password.</p>
    <p>If the console was cleared, press Enter or reopen the VM console to display the banner again.</p>
    <p>If you have host shell access, read the token with: <code>sudo cat /var/lib/alga-appliance/setup-token</code></p>
    <p>Forgot the management password? Run <code>sudo alga-appliance-reset-admin</code> to re-arm a fresh token.</p>`;
}

function preflightGuidanceForPhase(phase) {
  if (phase === 'dns') {
    return 'Confirm DHCP/static resolver configuration, internal DNS reachability, and split-horizon DNS expectations.';
  }
  if (phase === 'network') {
    return 'Confirm outbound HTTPS connectivity and proxy/firewall egress rules to required endpoints.';
  }
  if (phase === 'registry-release-source') {
    return 'Confirm outbound HTTPS to ghcr.io and that the selected appliance release channel exists.';
  }
  return 'Review host and network prerequisites, then retry setup.';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const mode = currentMode();

  if (url.pathname === '/healthz') {
    jsonResponse(res, 200, { ok: true, mode });
    return;
  }

  // --- authentication ------------------------------------------------------
  // The UI calls /api/auth/state on load to decide which screen to render:
  // token entry (first run), password login (configured), or straight in.
  if (url.pathname === '/api/auth/state') {
    jsonResponse(res, 200, { phase: authPhase(req), mode });
    return;
  }

  if (url.pathname === '/api/auth/redeem-token') {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      jsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }
    const ip = clientIp(req);
    const lock = checkLockout(ip);
    if (lock.locked) {
      jsonResponse(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(lock.retryAfterMs / 1000)}s.` });
      return;
    }
    if (getCredentialState().status === 'configured') {
      jsonResponse(res, 409, { error: 'A management password is already set. Sign in with your password.' });
      return;
    }
    const payload = await readJsonBody(req);
    if (tokensMatch(payload.token)) {
      registerSuccess(ip);
      jsonResponse(res, 200, { ok: true, next: 'set-password' });
    } else {
      registerFailure(ip);
      jsonResponse(res, 401, { error: 'Incorrect setup token.' });
    }
    return;
  }

  if (url.pathname === '/api/auth/set-password') {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      jsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }
    const ip = clientIp(req);
    const lock = checkLockout(ip);
    if (lock.locked) {
      jsonResponse(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(lock.retryAfterMs / 1000)}s.` });
      return;
    }
    if (getCredentialState().status === 'configured') {
      jsonResponse(res, 409, { error: 'A management password is already set. Sign in with your password.' });
      return;
    }
    const payload = await readJsonBody(req);
    if (!tokensMatch(payload.token)) {
      registerFailure(ip);
      jsonResponse(res, 401, { error: 'Incorrect setup token.' });
      return;
    }
    const pwError = passwordPolicyError(payload.password || '');
    if (pwError) {
      jsonResponse(res, 400, { error: pwError });
      return;
    }
    setPassword(payload.password);
    registerSuccess(ip);
    jsonResponseWithCookie(res, 200, { ok: true }, sessionCookieHeader());
    return;
  }

  if (url.pathname === '/api/auth/login') {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      jsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }
    const ip = clientIp(req);
    const lock = checkLockout(ip);
    if (lock.locked) {
      jsonResponse(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(lock.retryAfterMs / 1000)}s.` });
      return;
    }
    if (getCredentialState().status !== 'configured') {
      jsonResponse(res, 409, { error: 'No management password is set yet. Enter the setup token.' });
      return;
    }
    const payload = await readJsonBody(req);
    if (verifyPassword(payload.password || '')) {
      registerSuccess(ip);
      jsonResponseWithCookie(res, 200, { ok: true }, sessionCookieHeader());
    } else {
      registerFailure(ip);
      jsonResponse(res, 401, { error: 'Incorrect password.' });
    }
    return;
  }

  if (url.pathname === '/api/auth/logout') {
    jsonResponseWithCookie(res, 200, { ok: true }, clearSessionCookieHeader());
    return;
  }

  if (url.pathname === '/api/setup/config') {
    if (!requireAuth(req, res)) return;
    jsonResponse(res, 200, {
      mode,
      defaults: readSetupDefaults(req.headers.host || ''),
      network: systemNetworkSummary()
    });
    return;
  }

  if (url.pathname === '/api/setup') {
    if (!requireAuth(req, res)) return;
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      jsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }
    if (mode === 'status' && !setupReEditable()) {
      jsonResponse(res, 409, { error: 'Setup has already started.', redirectTo: '/' });
      return;
    }

    let payload;
    try {
      const body = await readRequestBody(req);
      payload = req.headers['content-type']?.includes('application/json')
        ? JSON.parse(body || '{}')
        : Object.fromEntries(new URLSearchParams(body));
      // Light well-formed JWS check for licenseKey (F077): three base64url-separated dots.
      const rawLicenseKey = (payload.licenseKey || '').trim();
      if (rawLicenseKey && !/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(rawLicenseKey)) {
        throw new Error('Invalid license key format.');
      }

      const setupInputs = validateSetupInputs({
        channel: payload.channel || 'stable',
        appHostname: payload.appHostname || '',
        dnsMode: payload.dnsMode || 'system',
        dnsServers: payload.dnsServers || '',
        releaseRef: payload.releaseRef || '',
        tenantName: payload.tenantName || '',
        adminFirstName: payload.adminFirstName || '',
        adminLastName: payload.adminLastName || '',
        adminEmail: payload.adminEmail || '',
        adminPassword: payload.adminPassword || '',
        adminPasswordConfirm: payload.adminPasswordConfirm || '',
        editionChoice: payload.editionChoice || 'ee',
        installCode: payload.installCode || '',
        licenseKey: rawLicenseKey || null
      });
      persistSetupInputs(setupInputs, setupInputsFile);
      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o750 });
      fs.writeFileSync(stateFile, `${JSON.stringify({
        status: 'setup-queued',
        phase: 'setup',
        lastAction: 'Setup accepted; background workflow is starting',
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`, { mode: 0o600 });
      // Fresh submit (incl. re-entering a corrected install code): reset the
      // auto-retry counter so the new attempt is not gated by the prior code's
      // exhausted retries.
      clearRetryState();
      queueSetupWorkflow();
      jsonResponse(res, 202, {
        ok: true,
        redirectTo: '/',
        acceptedInputs: {
          ...setupInputs,
          initialTenant: setupInputs.initialTenant ? {
            tenantName: setupInputs.initialTenant.tenantName,
            adminFirstName: setupInputs.initialTenant.adminFirstName,
            adminLastName: setupInputs.initialTenant.adminLastName,
            adminEmail: setupInputs.initialTenant.adminEmail
          } : undefined
        }
      });
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : 'Invalid setup inputs.' });
    }
    return;
  }

  if (url.pathname === '/api/status') {
    if (!requireAuth(req, res)) return;

    const signal = requestAbortSignal(req, res);
    const includeDiagnostics = url.searchParams.get('diagnostics') === '1';
    const now = Date.now();
    const cacheUsable = !includeDiagnostics && cachedStatusSnapshot && now - cachedStatusSnapshotAt < STATUS_CACHE_TTL_MS;
    const installStateForProbe = readInstallStateSafe();
    const wantNetworkProbe = networkProbeRelevant(installStateForProbe);
    const snapshot = cacheUsable
      ? cachedStatusSnapshot
      : await collectStatusSnapshotAsync({
        stateFile,
        setupInputsFile,
        releaseSelectionFile,
        kubeconfigPath,
        includeDiagnostics,
        kubectlTimeoutMs: KUBECTL_STATUS_TIMEOUT_MS,
        kubectlRequestTimeoutMs: KUBECTL_REQUEST_TIMEOUT_MS,
        networkProbe: wantNetworkProbe ? () => getNetworkProbe() : undefined,
        autoRetry: computeAutoRetrySummary(installStateForProbe),
        runCommand: (command, options = {}) => runQueuedKubectl(command, { timeoutMs: options.timeoutMs || KUBECTL_STATUS_TIMEOUT_MS, signal })
      });
    if (!includeDiagnostics && !cacheUsable) {
      cachedStatusSnapshot = snapshot;
      cachedStatusSnapshotAt = now;
    }
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    // setupReEditable is computed live (not from the cached snapshot) so the
    // status UI can offer a "re-enter your install code" action while setup is
    // blocked on a correctable (bad/used/expired) install code.
    res.end(JSON.stringify({ ...snapshot, setupReEditable: setupReEditable() }));
    return;
  }

  if (url.pathname === '/api/k8s/namespaces') {
    if (!requireAuth(req, res)) return;
    const signal = requestAbortSignal(req, res);
    const result = await runKubectlJson('get namespaces', KUBECTL_API_TIMEOUT_MS, signal);
    if (!result.ok) {
      jsonResponse(res, 502, { error: result.stderr || result.stdout || 'Unable to list namespaces.' });
      return;
    }
    jsonResponse(res, 200, {
      namespaces: (result.value?.items || []).map((item) => ({
        name: item.metadata?.name || 'unknown',
        phase: item.status?.phase || 'Unknown',
        createdAt: item.metadata?.creationTimestamp || null
      })).sort((a, b) => a.name.localeCompare(b.name))
    });
    return;
  }

  if (url.pathname === '/api/k8s/deployments') {
    if (!requireAuth(req, res)) return;
    const nsFlag = namespaceFlag(url.searchParams.get('namespace') || 'msp');
    if (!nsFlag) {
      jsonResponse(res, 400, { error: 'Invalid namespace.' });
      return;
    }
    const signal = requestAbortSignal(req, res);
    const deployments = await runKubectlJson(`${nsFlag} get deployments`, KUBECTL_API_TIMEOUT_MS, signal);
    const replicaSets = await runKubectlJson(`${nsFlag} get replicasets`, KUBECTL_API_TIMEOUT_MS, signal);
    if (!deployments.ok) {
      jsonResponse(res, 502, { error: deployments.stderr || deployments.stdout || 'Unable to list deployments.' });
      return;
    }
    jsonResponse(res, 200, {
      namespace: url.searchParams.get('namespace') || 'msp',
      deployments: (deployments.value?.items || []).map((item) => summarizeDeployment(item, replicaSets.value?.items || []))
        .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`))
    });
    return;
  }

  if (url.pathname === '/api/k8s/pods') {
    if (!requireAuth(req, res)) return;
    const nsFlag = namespaceFlag(url.searchParams.get('namespace') || 'msp');
    if (!nsFlag) {
      jsonResponse(res, 400, { error: 'Invalid namespace.' });
      return;
    }
    const signal = requestAbortSignal(req, res);
    const pods = await runKubectlJson(`${nsFlag} get pods`, KUBECTL_API_TIMEOUT_MS, signal);
    if (!pods.ok) {
      jsonResponse(res, 502, { error: pods.stderr || pods.stdout || 'Unable to list pods.' });
      return;
    }
    jsonResponse(res, 200, {
      namespace: url.searchParams.get('namespace') || 'msp',
      pods: (pods.value?.items || []).map(summarizePod)
        .sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`))
    });
    return;
  }

  if (url.pathname === '/api/k8s/logs') {
    if (!requireAuth(req, res)) return;
    const namespace = url.searchParams.get('namespace') || 'msp';
    const pod = url.searchParams.get('pod') || '';
    const container = url.searchParams.get('container') || '';
    const tail = Math.max(1, Math.min(10_000, Number(url.searchParams.get('tail') || 200)));
    const previous = url.searchParams.get('previous') === '1';
    if (!validKubeName(namespace) || !validKubeName(pod) || (container && !validContainerName(container))) {
      jsonResponse(res, 400, { error: 'Invalid namespace, pod, or container.' });
      return;
    }
    const containerArg = container ? ` -c ${shellQuote(container)}` : '';
    const previousArg = previous ? ' --previous' : '';
    const signal = requestAbortSignal(req, res);
    const result = await runQueuedKubectl(kubectlCommand(`-n ${shellQuote(namespace)} logs ${shellQuote(pod)}${containerArg} --tail=${tail}${previousArg}`, KUBECTL_LOG_TIMEOUT_MS), { timeoutMs: KUBECTL_LOG_TIMEOUT_MS, signal });
    if (!result.ok) {
      jsonResponse(res, 502, { error: result.stderr || result.stdout || 'Unable to read logs.' });
      return;
    }
    const lines = result.stdout.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    jsonResponse(res, 200, { namespace, pod, container: container || null, tail, previous, lines });
    return;
  }

  if (url.pathname === '/api/support-bundle') {
    if (!requireAuth(req, res)) return;
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }

    const result = generateSupportBundle({ stateFile, setupInputsFile, releaseSelectionFile });
    res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/recover') {
    if (!requireAuth(req, res)) return;
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      jsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }

    // Force a Flux reconcile of the alga-core HelmRelease (same as
    // `flux reconcile helmrelease alga-core --force`): bumping requestedAt and
    // forceAt to the same value makes the helm-controller run a forced upgrade,
    // which creates a fresh bootstrap Job. That job re-runs migrations,
    // onboarding seeds, and creates the initial tenant/admin if no users exist.
    const namespace = 'alga-system';
    const name = 'alga-core';
    const requestedAt = new Date().toISOString();
    const signal = requestAbortSignal(req, res);
    const command = kubectlCommand(`-n ${shellQuote(namespace)} annotate helmrelease ${shellQuote(name)} reconcile.fluxcd.io/requestedAt=${shellQuote(requestedAt)} reconcile.fluxcd.io/forceAt=${shellQuote(requestedAt)} --overwrite`, KUBECTL_API_TIMEOUT_MS);
    const result = await runQueuedKubectl(command, { timeoutMs: KUBECTL_API_TIMEOUT_MS, signal });
    if (!result.ok) {
      jsonResponse(res, 502, { error: result.stderr || result.stdout || 'Failed to trigger reconcile.', helmRelease: `${namespace}/${name}` });
      return;
    }
    jsonResponse(res, 200, {
      ok: true,
      helmRelease: `${namespace}/${name}`,
      requestedAt,
      message: 'Forced a Flux reconcile of alga-core. A fresh bootstrap job will run migrations and onboarding seeds, and create the initial tenant/admin if it is missing. This usually takes about a minute.'
    });
    return;
  }

  if (url.pathname === '/api/updates') {
    if (!requireAuth(req, res)) return;
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }

    const body = await readRequestBody(req);
    const params = new URLSearchParams(body);
    const channel = (params.get('channel') || 'stable').trim();
    if (!['stable', 'nightly'].includes(channel)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid channel. Use stable or nightly.' }));
      return;
    }

    const result = await runAppChannelUpdate({ channel });
    res.writeHead(result.ok ? 200 : 412, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/updates') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: sign in to continue.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <h1>App Channel Updates</h1>
      <p>Updates here only change Alga application channel/release state. Ubuntu and k3s updates are manual/support-run in v1.</p>
      <form method="post" action="/api/updates">
        <label>Channel</label>
        <select name="channel">
          <option value="stable" selected>stable</option>
          <option value="nightly">nightly (testing/support-directed)</option>
        </select>
        <button type="submit">Apply Update</button>
      </form>
    </body></html>`);
    return;
  }

  if (url.pathname === '/support-bundle') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: sign in to continue.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <h1>Generate Support Bundle</h1>
      <p>This bundle includes host service logs, setup state, Kubernetes/Flux/Helm diagnostics, network checks, disk usage, and redacted metadata.</p>
      <form method="post" action="/api/support-bundle">
        <button type="submit">Generate Bundle</button>
      </form>
      <p>CLI fallback: <code>/usr/bin/env node /opt/alga-appliance/host-service/support-bundle.mjs</code> (or call the status API).</p>
    </body></html>`);
    return;
  }

  if (url.pathname === '/setup' || url.pathname === '/setup/') {
    // The setup page is the SPA shell; it gates its own content via
    // /api/auth/state. Only the legacy server-rendered POST mutates state, so
    // that path requires a session.
    // Once setup has started we redirect to the status view — UNLESS it is
    // blocked on an operator-correctable install code, in which case we keep the
    // form reachable so they can re-enter a re-issued code.
    if (mode === 'status' && !setupReEditable()) {
      res.writeHead(303, { location: '/' });
      res.end();
      return;
    }

    if ((req.method || 'GET').toUpperCase() === 'POST') {
      if (!isAuthenticated(req)) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Unauthorized: sign in to continue.');
        return;
      }
      const body = await readRequestBody(req);
      const params = new URLSearchParams(body);
      let setupInputs;

      try {
        setupInputs = validateSetupInputs({
          channel: params.get('channel') || 'stable',
          appHostname: params.get('appHostname') || '',
          dnsMode: params.get('dnsMode') || 'system',
          dnsServers: params.get('dnsServers') || '',
          releaseRef: params.get('releaseRef') || '',
          tenantName: params.get('tenantName') || '',
          adminFirstName: params.get('adminFirstName') || '',
          adminLastName: params.get('adminLastName') || '',
          adminEmail: params.get('adminEmail') || '',
          adminPassword: params.get('adminPassword') || '',
          adminPasswordConfirm: params.get('adminPasswordConfirm') || ''
        });
        persistSetupInputs(setupInputs, setupInputsFile);
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(error instanceof Error ? error.message : 'Invalid setup inputs.');
        return;
      }

      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o750 });
      fs.writeFileSync(stateFile, `${JSON.stringify({
        status: 'setup-queued',
        phase: 'setup',
        lastAction: 'Setup accepted; background workflow is starting',
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`, { mode: 0o600 });
      queueSetupWorkflow();

      res.writeHead(303, { location: '/' });
      res.end();
      return;
    }

    const staticSetup = safeStaticFileForPathname('/setup/');
    if (staticSetup) {
      serveStaticFile(res, staticSetup);
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <h1>Alga Appliance Setup</h1>
      <form method="post" action="/setup">
        <label>Release channel</label><br />
        <select name="channel">
          <option value="stable" selected>stable (recommended)</option>
          <option value="nightly">nightly (testing/support-directed)</option>
        </select><br /><br />

        <label>App URL</label><br />
        <input type="text" name="appHostname" value="${defaultAppUrlForRequest(req.headers.host || '')}" placeholder="http://192.168.1.50:3000" /><br />
        <small>Use the full URL users will enter in their browser. The default local URL works out of the box.</small><br /><br />

        <fieldset>
          <legend>Initial account</legend>
          <label>Company name</label><br />
          <input type="text" name="tenantName" required /><br /><br />
          <label>Admin first name</label><br />
          <input type="text" name="adminFirstName" required /><br /><br />
          <label>Admin last name</label><br />
          <input type="text" name="adminLastName" required /><br /><br />
          <label>Admin email</label><br />
          <input type="email" name="adminEmail" required /><br /><br />
          <label>Admin password</label><br />
          <input type="password" name="adminPassword" autocomplete="new-password" required /><br /><br />
          <label>Confirm admin password</label><br />
          <input type="password" name="adminPasswordConfirm" autocomplete="new-password" required /><br />
          <small>Use at least 8 characters with uppercase, lowercase, number, and special character.</small><br /><br />
        </fieldset>

        <label>DNS mode</label><br />
        <select name="dnsMode">
          <option value="system" selected>Use DHCP/system resolvers (default)</option>
          <option value="custom">Use custom DNS servers</option>
        </select><br />
        <small>Only choose custom DNS deliberately. Internal MSP DNS is commonly required.</small><br /><br />

        <label>Custom DNS servers (comma-separated)</label><br />
        <input type="text" name="dnsServers" placeholder="8.8.8.8,8.8.4.4" /><br /><br />

        <label>Release pin (advanced; blank follows the channel)</label><br />
        <input type="text" name="releaseRef" placeholder="e.g. 1.0.3 or sha256:..." /><br /><br />

        <button type="submit">Save and continue</button>
      </form>
    </body></html>`);
    return;
  }

  const staticAsset = safeStaticFileForPathname(url.pathname);
  if (staticAsset && url.pathname !== '/' && url.pathname !== '/setup' && url.pathname !== '/setup/') {
    serveStaticFile(res, staticAsset);
    return;
  }

  // Page routes: serve the SPA shell, which gates its own content via
  // /api/auth/state. The login/PIN screen needs no server-side session.
  const staticHome = safeStaticFileForPathname('/');
  if (staticHome) {
    serveStaticFile(res, staticHome);
    return;
  }

  // No static bundle (dev/edge): the server-rendered fallbacks below expose
  // live appliance data, so they require a session.
  if (!isAuthenticated(req)) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Unauthorized: sign in to continue.');
    return;
  }

  if (mode === 'status') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const signal = requestAbortSignal(req, res);
    const installStateForProbe = readInstallStateSafe();
    const wantNetworkProbe = networkProbeRelevant(installStateForProbe);
    const snapshot = await collectStatusSnapshotAsync({
      stateFile,
      setupInputsFile,
      releaseSelectionFile,
        kubeconfigPath,
      kubectlTimeoutMs: KUBECTL_STATUS_TIMEOUT_MS,
      kubectlRequestTimeoutMs: KUBECTL_REQUEST_TIMEOUT_MS,
      networkProbe: wantNetworkProbe ? () => getNetworkProbe() : undefined,
      autoRetry: computeAutoRetrySummary(installStateForProbe),
      runCommand: (command, options = {}) => runQueuedKubectl(command, { timeoutMs: options.timeoutMs || KUBECTL_STATUS_TIMEOUT_MS, signal })
    });
    const failureItems = (snapshot.failures || [])
      .map((failure) => `<li><strong>${escapeHtml(failure.category)}</strong>: ${escapeHtml(failure.suspectedCause)}<br/><em>Next:</em> ${escapeHtml(failure.suggestedNextStep)}<br/><em>Retry safe:</em> ${failure.retrySafe ? 'yes' : 'no'}${failure.logs?.length ? `<br/><em>Useful commands:</em><pre>${escapeHtml(failure.logs.join('\n'))}</pre>` : ''}</li>`)
      .join('');
    const installerOutput = snapshot.installState?.installerOutput
      ? `${renderPreBlock('Installer stdout', snapshot.installState.installerOutput.stdout || '')}${renderPreBlock('Installer stderr', snapshot.installState.installerOutput.stderr || '')}`
      : '<p>No installer output recorded for the current phase.</p>';
    const diagnostics = (snapshot.diagnostics || [])
      .map((diagnostic) => renderPreBlock(`${diagnostic.name} — exit ${diagnostic.status}`, `$ ${diagnostic.command}\n\nSTDOUT:\n${diagnostic.stdout || ''}\n\nSTDERR:\n${diagnostic.stderr || ''}`))
      .join('');
    res.end(`<!doctype html><html><head><style>
      body { font-family: sans-serif; max-width: 1200px; margin: 2rem auto; line-height: 1.4; }
      pre { background: #111; color: #eee; padding: 1rem; overflow: auto; max-height: 32rem; white-space: pre-wrap; }
      details { margin: 1rem 0; }
      summary { cursor: pointer; font-weight: 600; }
    </style></head><body>
      <h1>Alga Appliance Status</h1>
      <p><strong>Mode:</strong> status</p>
      <p><strong>Current phase:</strong> ${escapeHtml(snapshot.currentPhase || 'unknown')}</p>
      <p><strong>Status:</strong> ${escapeHtml(snapshot.status || 'unknown')}</p>
      <p><strong>Last action:</strong> ${escapeHtml(snapshot.installState?.lastAction || 'n/a')}</p>
      <h2>Readiness</h2>
      <p>platform=${snapshot.tiers.platformReady} core=${snapshot.tiers.coreReady} bootstrap=${snapshot.tiers.bootstrapReady} login=${snapshot.tiers.loginReady} background=${snapshot.tiers.backgroundReady} fullyHealthy=${snapshot.tiers.fullyHealthy}</p>
      <h2>Failures</h2>
      ${failureItems ? `<ul>${failureItems}</ul>` : '<p>No active failures detected.</p>'}
      <h2>Installer output</h2>
      ${installerOutput}
      <h2>Install state</h2>
      ${renderPreBlock('Raw install-state.json', snapshot.installState || {})}
      <h2>Live diagnostics</h2>
      ${diagnostics || '<p>No diagnostics collected.</p>'}
    </body></html>`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><body><h1>Alga Appliance Setup</h1><p>Mode: ${mode}</p>${tokenHelpHtml()}<p>Open <code>/setup</code> to continue.</p></body></html>`);
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`alga-appliance host service listening on :${port}\n`);
});

if (!AUTO_RETRY_DISABLED) {
  const reconcileTimer = setInterval(() => { reconcileBlockedSetup().catch(() => {}); }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
  process.stdout.write(`alga-appliance auto-retry reconciler enabled (every ${RECONCILE_INTERVAL_MS}ms, max ${AUTO_RETRY_MAX_ATTEMPTS} attempts)\n`);
}
