import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const consoleScript = path.join(repoRoot, 'ee', 'appliance', 'host-service', 'console.mjs');
const serverScript = path.join(repoRoot, 'ee', 'appliance', 'host-service', 'server.mjs');

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function httpGet(url, headers) {
  return httpRequest(url, { headers });
}

function postJson(url, payload, headers = {}) {
  return httpRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
}

test('T003 first-boot smoke: console banner and the token -> password -> session flow', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-t003-'));
  const tokenFile = path.join(tmp, 'setup-token');
  const staticUiDir = path.join(tmp, 'status-ui');
  const issueFile = path.join(tmp, 'issue');
  const motdFile = path.join(tmp, 'motd');
  const runBannerFile = path.join(tmp, 'run-banner');
  const consoleTtyFile = path.join(tmp, 'tty1');
  const buildInfoFile = path.join(tmp, 'build-info.json');
  fs.writeFileSync(tokenFile, 'token-123\n');
  fs.writeFileSync(consoleTtyFile, '');
  fs.writeFileSync(buildInfoFile, JSON.stringify({ buildTimestamp: '2026-05-27T19:42:11Z' }));
  fs.mkdirSync(path.join(staticUiDir, 'setup'), { recursive: true });
  fs.mkdirSync(path.join(staticUiDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(staticUiDir, 'index.html'), '<!doctype html><h1>Status UI</h1>');
  fs.writeFileSync(path.join(staticUiDir, 'setup', 'index.html'), '<!doctype html><h1>Setup UI</h1>');
  fs.writeFileSync(path.join(staticUiDir, 'assets', 'app.js'), 'console.log("status-ui");');

  const consoleResult = await new Promise((resolve) => {
    const child = spawn(process.execPath, [consoleScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ALGA_APPLIANCE_TOKEN_FILE: tokenFile,
        ALGA_APPLIANCE_PORT: '18080',
        ALGA_APPLIANCE_ISSUE_FILE: issueFile,
        ALGA_APPLIANCE_MOTD_FILE: motdFile,
        ALGA_APPLIANCE_RUN_BANNER_FILE: runBannerFile,
        ALGA_APPLIANCE_CONSOLE_TTYS: consoleTtyFile,
        ALGA_APPLIANCE_BUILD_INFO_FILE: buildInfoFile
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(consoleResult.code, 0, consoleResult.stderr);
  assert.match(consoleResult.stdout, /Alga Appliance setup handoff/);
  assert.match(consoleResult.stdout, /Build timestamp: 2026-05-27T19:42:11Z/);
  assert.match(consoleResult.stdout, /setup UI served by the Kubernetes-hosted control plane/);
  assert.match(consoleResult.stdout, /Setup URL: http:\/\/.+:18080\//);
  assert.match(consoleResult.stdout, /One-time setup token: token-123/);
  assert.match(consoleResult.stdout, /Sign in to this host with the account you created during installation/);
  assert.match(consoleResult.stdout, /Forgot the management password\? sudo alga-appliance-reset-admin/);
  // The OS credential is no longer generated or printed.
  assert.doesNotMatch(consoleResult.stdout, /Temporary password/);
  assert.doesNotMatch(consoleResult.stdout, /Password change required/);
  assert.doesNotMatch(consoleResult.stdout, /-u alga-appliance\.service/);
  assert.match(fs.readFileSync(issueFile, 'utf8'), /One-time setup token: token-123/);
  assert.match(fs.readFileSync(motdFile, 'utf8'), /Setup URL: http:\/\/.+:18080\//);
  assert.doesNotMatch(fs.readFileSync(motdFile, 'utf8'), /\?token=/);
  assert.match(fs.readFileSync(consoleTtyFile, 'utf8'), /One-time setup token: token-123/);

  const server = spawn(process.execPath, [serverScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ALGA_APPLIANCE_DISABLE_SETUP_QUEUE: '1',
      ALGA_APPLIANCE_PORT: '18081',
      ALGA_APPLIANCE_TOKEN_FILE: tokenFile,
      ALGA_APPLIANCE_ADMIN_CREDENTIAL_FILE: path.join(tmp, 'admin-ui-credential.json'),
      ALGA_APPLIANCE_SESSION_SECRET_FILE: path.join(tmp, 'session-secret'),
      ALGA_APPLIANCE_STATE_FILE: path.join(tmp, 'install-state.json'),
      ALGA_APPLIANCE_SETUP_INPUTS_FILE: path.join(tmp, 'setup-inputs.json'),
      ALGA_APPLIANCE_STATUS_UI_DIR: staticUiDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const base = 'http://127.0.0.1:18081';
  try {
    await new Promise((resolve) => setTimeout(resolve, 350));

    const health = await httpGet(`${base}/healthz`);
    assert.equal(health.statusCode, 200);

    // Fresh appliance: needs the one-time token first.
    const state0 = await httpGet(`${base}/api/auth/state`);
    assert.equal(state0.statusCode, 200);
    assert.equal(JSON.parse(state0.body).phase, 'needs-token');

    // The SPA shell is served without a session (it renders the login screen).
    const setupPage = await httpGet(`${base}/setup`);
    assert.equal(setupPage.statusCode, 200);
    assert.match(setupPage.body, /Setup UI/);
    const staticAsset = await httpGet(`${base}/assets/app.js`);
    assert.equal(staticAsset.statusCode, 200);

    // Data endpoints are gated.
    const configNoAuth = await httpGet(`${base}/api/setup/config`);
    assert.equal(configNoAuth.statusCode, 401);

    // Wrong token is rejected; correct token advances to set-password.
    const badToken = await postJson(`${base}/api/auth/redeem-token`, { token: 'nope' });
    assert.equal(badToken.statusCode, 401);
    const goodToken = await postJson(`${base}/api/auth/redeem-token`, { token: 'token-123' });
    assert.equal(goodToken.statusCode, 200);

    // Weak password is rejected.
    const weak = await postJson(`${base}/api/auth/set-password`, { token: 'token-123', password: 'short' });
    assert.equal(weak.statusCode, 400);

    // Set the management password -> receive a session cookie.
    const setPw = await postJson(`${base}/api/auth/set-password`, { token: 'token-123', password: 'Str0ng!Pass' });
    assert.equal(setPw.statusCode, 200);
    const setCookie = (setPw.headers['set-cookie'] || [])[0] || '';
    assert.match(setCookie, /alga_appliance_session=/);
    const cookie = setCookie.split(';')[0];

    // Token is now consumed: redeeming again is a conflict.
    const reRedeem = await postJson(`${base}/api/auth/redeem-token`, { token: 'token-123' });
    assert.equal(reRedeem.statusCode, 409);

    // Authenticated now.
    const stateAuthed = await httpGet(`${base}/api/auth/state`, { Cookie: cookie });
    assert.equal(JSON.parse(stateAuthed.body).phase, 'authenticated');

    const config = await httpGet(`${base}/api/setup/config`, { Cookie: cookie, Host: '192.0.2.10:18081' });
    assert.equal(config.statusCode, 200);
    const configBody = JSON.parse(config.body);
    assert.equal(configBody.mode, 'setup');
    assert.equal(configBody.defaults.channel, 'stable');
    assert.equal(configBody.defaults.appHostname, 'http://192.0.2.10:3000');

    const submit = await postJson(`${base}/api/setup`, {
      channel: 'stable',
      appHostname: 'alga.example.com',
      dnsMode: 'system',
      tenantName: 'Acme MSP',
      adminFirstName: 'Ava',
      adminLastName: 'Admin',
      adminEmail: 'ava@example.com',
      adminPassword: 'Str0ng!Pass',
      adminPasswordConfirm: 'Str0ng!Pass'
    }, { Cookie: cookie });
    assert.equal(submit.statusCode, 202);
    const submitBody = JSON.parse(submit.body);
    assert.equal(submitBody.ok, true);
    assert.equal(submitBody.acceptedInputs.appHostname, 'alga.example.com');
    const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'setup-inputs.json'), 'utf8'));
    assert.equal(persisted.initialTenant.adminEmail, 'ava@example.com');
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'install-state.json'), 'utf8')).status, 'setup-queued');

    const statusPage = await httpGet(`${base}/`, { Cookie: cookie });
    assert.equal(statusPage.statusCode, 200);
    assert.match(statusPage.body, /Status UI/);

    // Logging in again with the chosen password works; wrong password does not.
    const loginOk = await postJson(`${base}/api/auth/login`, { password: 'Str0ng!Pass' });
    assert.equal(loginOk.statusCode, 200);
    const loginBad = await postJson(`${base}/api/auth/login`, { password: 'nope' });
    assert.equal(loginBad.statusCode, 401);
  } finally {
    server.kill('SIGTERM');
  }
});
