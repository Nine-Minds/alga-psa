#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import { URL } from 'node:url';
import { persistSetupInputs, runSetupWorkflow, validateSetupInputs } from './setup-engine.mjs';

const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);
const stateFile = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';
const tokenFile = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const setupInputsFile = process.env.ALGA_APPLIANCE_SETUP_INPUTS_FILE || '/etc/alga-appliance/setup-inputs.json';

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const mode = currentMode();
  const setupToken = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '';

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode }));
    return;
  }

  if (url.pathname === '/setup') {
    const providedToken = url.searchParams.get('token') || '';
    if (!setupToken || providedToken !== setupToken) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized: valid setup token required.');
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

      const setupResult = await runSetupWorkflow(setupInputs, { stateFile });
      if (!setupResult.ok) {
        res.writeHead(412, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><body>
          <h1>Setup blocked</h1>
          <p><strong>Phase:</strong> ${setupResult.phase}</p>
          <p><strong>Step:</strong> ${setupResult.step}</p>
          <p><strong>Cause:</strong> ${setupResult.suspectedCause}</p>
          <p><strong>Suggested next step:</strong> ${setupResult.suggestedNextStep}</p>
          <p><strong>Retry safe:</strong> ${setupResult.retrySafe ? 'yes' : 'no'}</p>
          <p>Fix the blocker and submit setup again. If this blocker is preflight-related, k3s installation has not started.</p>
        </body></html>`);
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>Setup Started</h1><p>Preflight and k3s installation steps completed successfully.</p></body></html>');
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

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><body><h1>Alga Appliance ${mode === 'setup' ? 'Setup' : 'Status'}</h1><p>Mode: ${mode}</p></body></html>`);
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`alga-appliance host service listening on :${port}\n`);
});
