#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { collectStatusSnapshot } from './status-engine.mjs';
import { persistSetupInputs, validateSetupInputs } from './setup-engine.mjs';
import { generateSupportBundle } from './support-bundle.mjs';
import { runAppChannelUpdate } from './update-engine.mjs';

const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);
const stateFile = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';
const tokenFile = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const setupInputsFile = process.env.ALGA_APPLIANCE_SETUP_INPUTS_FILE || '/etc/alga-appliance/setup-inputs.json';
const staticUiDir = process.env.ALGA_APPLIANCE_STATUS_UI_DIR || '/opt/alga-appliance/status-ui/dist';
const STATUS_CACHE_TTL_MS = Number(process.env.ALGA_APPLIANCE_STATUS_CACHE_TTL_MS || 10_000);
let cachedStatusSnapshot = null;
let cachedStatusSnapshotAt = 0;

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
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
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
  if (normalized.includes('..')) return null;

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

function readSetupDefaults() {
  const fallback = {
    channel: 'stable',
    appHostname: '',
    dnsMode: 'system',
    dnsServers: '',
    repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
    repoBranch: ''
  };
  if (!fs.existsSync(setupInputsFile)) return fallback;
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(setupInputsFile, 'utf8')) };
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
    '--state-file', stateFile
  ], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  });
  child.unref();
}

function tokenHelpHtml() {
  return `<p>The setup/status token and temporary local admin password are printed on the VM console and persisted in the login banner.</p>
    <p>If the console was cleared, press Enter or reopen the VM console to display the banner again.</p>
    <p>If you have host shell access, read the token with: <code>sudo cat /var/lib/alga-appliance/setup-token</code></p>`;
}

function preflightGuidanceForPhase(phase) {
  if (phase === 'dns') {
    return 'Confirm DHCP/static resolver configuration, internal DNS reachability, and split-horizon DNS expectations.';
  }
  if (phase === 'network') {
    return 'Confirm outbound HTTPS connectivity and proxy/firewall egress rules to required endpoints.';
  }
  if (phase === 'github-release-source') {
    return 'Confirm access to raw.githubusercontent.com and selected channel file for the configured repo/branch.';
  }
  return 'Review host and network prerequisites, then retry setup.';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const mode = currentMode();
  const setupToken = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '';

  if (url.pathname === '/healthz') {
    jsonResponse(res, 200, { ok: true, mode });
    return;
  }

  if (url.pathname === '/api/setup/config') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      jsonResponse(res, 401, { error: 'Unauthorized: valid setup token required.' });
      return;
    }
    jsonResponse(res, 200, {
      mode,
      defaults: readSetupDefaults(),
      network: systemNetworkSummary()
    });
    return;
  }

  if (url.pathname === '/api/setup') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      jsonResponse(res, 401, { error: 'Unauthorized: valid setup token required.' });
      return;
    }
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      jsonResponse(res, 405, { error: 'Method not allowed. Use POST.' });
      return;
    }
    if (mode === 'status') {
      jsonResponse(res, 409, { error: 'Setup has already started.', redirectTo: `/?token=${encodeURIComponent(providedToken)}` });
      return;
    }

    let payload;
    try {
      const body = await readRequestBody(req);
      payload = req.headers['content-type']?.includes('application/json')
        ? JSON.parse(body || '{}')
        : Object.fromEntries(new URLSearchParams(body));
      const setupInputs = validateSetupInputs({
        channel: payload.channel || 'stable',
        appHostname: payload.appHostname || '',
        dnsMode: payload.dnsMode || 'system',
        dnsServers: payload.dnsServers || '',
        repoUrl: payload.repoUrl || 'https://github.com/Nine-Minds/alga-psa.git',
        repoBranch: payload.repoBranch || ''
      });
      persistSetupInputs(setupInputs, setupInputsFile);
      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o750 });
      fs.writeFileSync(stateFile, `${JSON.stringify({
        status: 'setup-queued',
        phase: 'setup',
        lastAction: 'Setup accepted; background workflow is starting',
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`, { mode: 0o600 });
      queueSetupWorkflow();
      jsonResponse(res, 202, { ok: true, redirectTo: `/?token=${encodeURIComponent(providedToken)}` });
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : 'Invalid setup inputs.' });
    }
    return;
  }

  if (url.pathname === '/api/status') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: valid status token required.' }));
      return;
    }

    const includeDiagnostics = url.searchParams.get('diagnostics') === '1';
    const now = Date.now();
    const cacheUsable = !includeDiagnostics && cachedStatusSnapshot && now - cachedStatusSnapshotAt < STATUS_CACHE_TTL_MS;
    const snapshot = cacheUsable
      ? cachedStatusSnapshot
      : collectStatusSnapshot({ stateFile, includeDiagnostics });
    if (!includeDiagnostics) {
      cachedStatusSnapshot = snapshot;
      cachedStatusSnapshotAt = now;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(snapshot));
    return;
  }

  if (url.pathname === '/api/support-bundle') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: valid status token required.' }));
      return;
    }
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }

    const result = generateSupportBundle();
    res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/updates') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: valid status token required.' }));
      return;
    }
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
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: valid status token required.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <h1>App Channel Updates</h1>
      <p>Updates here only change Alga application channel/release state. Ubuntu and k3s updates are manual/support-run in v1.</p>
      <form method="post" action="/api/updates?token=${encodeURIComponent(providedToken)}">
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
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: valid status token required.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <h1>Generate Support Bundle</h1>
      <p>This bundle includes host service logs, setup state, Kubernetes/Flux/Helm diagnostics, network checks, disk usage, and redacted metadata.</p>
      <form method="post" action="/api/support-bundle?token=${encodeURIComponent(providedToken)}">
        <button type="submit">Generate Bundle</button>
      </form>
      <p>CLI fallback: <code>/usr/bin/env node /opt/alga-appliance/host-service/support-bundle.mjs</code> (or call the status API).</p>
    </body></html>`);
    return;
  }

  if (url.pathname === '/setup') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: valid setup token required.');
      return;
    }

    if (mode === 'status') {
      res.writeHead(303, { location: `/?token=${encodeURIComponent(providedToken)}` });
      res.end();
      return;
    }

    if ((req.method || 'GET').toUpperCase() === 'POST') {
      const body = await readRequestBody(req);
      const params = new URLSearchParams(body);
      let setupInputs;

      try {
        setupInputs = validateSetupInputs({
          channel: params.get('channel') || 'stable',
          appHostname: params.get('appHostname') || '',
          dnsMode: params.get('dnsMode') || 'system',
          dnsServers: params.get('dnsServers') || '',
          repoUrl: params.get('repoUrl') || 'https://github.com/Nine-Minds/alga-psa.git',
          repoBranch: params.get('repoBranch') || ''
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

      res.writeHead(303, { location: `/?token=${encodeURIComponent(providedToken)}` });
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
      <form method="post" action="/setup?token=${encodeURIComponent(providedToken)}">
        <label>Release channel</label><br />
        <select name="channel">
          <option value="stable" selected>stable (recommended)</option>
          <option value="nightly">nightly (testing/support-directed)</option>
        </select><br /><br />

        <label>App URL / hostname</label><br />
        <input type="text" name="appHostname" placeholder="psa.example.com" /><br /><br />

        <label>DNS mode</label><br />
        <select name="dnsMode">
          <option value="system" selected>Use DHCP/system resolvers (default)</option>
          <option value="custom">Use custom DNS servers</option>
        </select><br />
        <small>Only choose custom DNS deliberately. Internal MSP DNS is commonly required.</small><br /><br />

        <label>Custom DNS servers (comma-separated)</label><br />
        <input type="text" name="dnsServers" placeholder="8.8.8.8,8.8.4.4" /><br /><br />

        <label>Repo URL override (support/testing only)</label><br />
        <input type="text" name="repoUrl" value="https://github.com/Nine-Minds/alga-psa.git" /><br /><br />

        <label>Repo branch override (support/testing only)</label><br />
        <input type="text" name="repoBranch" placeholder="main" /><br /><br />

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

  if (mode === 'status') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: valid status token required.');
      return;
    }
    const staticHome = safeStaticFileForPathname('/');
    if (staticHome) {
      serveStaticFile(res, staticHome);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    const snapshot = collectStatusSnapshot({ stateFile });
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
  res.end(`<!doctype html><html><body><h1>Alga Appliance Setup</h1><p>Mode: ${mode}</p>${tokenHelpHtml()}<p>Open <code>/setup?token=&lt;setup-token&gt;</code> to continue.</p></body></html>`);
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`alga-appliance host service listening on :${port}\n`);
});
