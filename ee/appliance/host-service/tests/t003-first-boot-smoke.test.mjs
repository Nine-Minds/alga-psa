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

function httpGet(url) {
  return httpRequest(url);
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

test('T003 first-boot smoke: console output and host web service health', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-t003-'));
  const tokenFile = path.join(tmp, 'setup-token');
  const staticUiDir = path.join(tmp, 'status-ui');
  const issueFile = path.join(tmp, 'issue');
  const motdFile = path.join(tmp, 'motd');
  const runBannerFile = path.join(tmp, 'run-banner');
  const adminPasswordFile = path.join(tmp, 'admin-password');
  const adminPasswordStateFile = path.join(tmp, 'admin-password-state.json');
  fs.writeFileSync(tokenFile, 'token-123\n');
  fs.writeFileSync(adminPasswordFile, 'admin-temp-123\n');
  fs.writeFileSync(adminPasswordStateFile, JSON.stringify({ status: 'temporary', user: 'alga-admin', changeRequired: true }));
  fs.mkdirSync(path.join(staticUiDir, 'setup'), { recursive: true });
  fs.mkdirSync(path.join(staticUiDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(staticUiDir, 'index.html'), '<!doctype html><h1>Status UI</h1>');
  fs.writeFileSync(path.join(staticUiDir, 'setup', 'index.html'), '<!doctype html><h1>Setup UI</h1>');
  fs.writeFileSync(path.join(staticUiDir, 'assets', 'app.js'), 'console.log("status-ui");');

  const consoleResult = await new Promise((resolve) => {
    const child = spawn('node', [consoleScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ALGA_APPLIANCE_TOKEN_FILE: tokenFile,
        ALGA_APPLIANCE_PORT: '18080',
        ALGA_APPLIANCE_ISSUE_FILE: issueFile,
        ALGA_APPLIANCE_MOTD_FILE: motdFile,
        ALGA_APPLIANCE_RUN_BANNER_FILE: runBannerFile,
        ALGA_APPLIANCE_ADMIN_USER: 'alga-admin',
        ALGA_APPLIANCE_ADMIN_PASSWORD_FILE: adminPasswordFile,
        ALGA_APPLIANCE_ADMIN_PASSWORD_STATE_FILE: adminPasswordStateFile
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
  assert.match(consoleResult.stdout, /Setup URL:/);
  assert.match(consoleResult.stdout, /Setup token: token-123/);
  assert.match(consoleResult.stdout, /User: alga-admin/);
  assert.match(consoleResult.stdout, /Temporary password: admin-temp-123/);
  assert.match(consoleResult.stdout, /Password change required on first login/);
  assert.match(consoleResult.stdout, /Console setup fallback:/);
  assert.match(fs.readFileSync(issueFile, 'utf8'), /Setup token: token-123/);
  assert.match(fs.readFileSync(motdFile, 'utf8'), /Setup URL: http:\/\/.+:18080\/setup\?token=token-123/);
  assert.match(fs.readFileSync(runBannerFile, 'utf8'), /Alga Appliance setup is ready/);

  const server = spawn('node', [serverScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ALGA_APPLIANCE_DISABLE_SETUP_QUEUE: '1',
      ALGA_APPLIANCE_PORT: '18081',
      ALGA_APPLIANCE_TOKEN_FILE: tokenFile,
      ALGA_APPLIANCE_STATE_FILE: path.join(tmp, 'install-state.json'),
      ALGA_APPLIANCE_SETUP_INPUTS_FILE: path.join(tmp, 'setup-inputs.json'),
      ALGA_APPLIANCE_STATUS_UI_DIR: staticUiDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const health = await httpGet('http://127.0.0.1:18081/healthz');
    assert.equal(health.statusCode, 200);
    assert.match(health.body, /"ok":true/);

    const unauthorizedSetup = await httpGet('http://127.0.0.1:18081/setup');
    assert.equal(unauthorizedSetup.statusCode, 401);

    const setupPage = await httpGet('http://127.0.0.1:18081/setup?token=token-123');
    assert.equal(setupPage.statusCode, 200);
    assert.match(setupPage.body, /Setup UI/);

    const staticAsset = await httpGet('http://127.0.0.1:18081/assets/app.js');
    assert.equal(staticAsset.statusCode, 200);
    assert.match(staticAsset.body, /status-ui/);

    const config = await httpGet('http://127.0.0.1:18081/api/setup/config?token=token-123');
    assert.equal(config.statusCode, 200);
    const configBody = JSON.parse(config.body);
    assert.equal(configBody.mode, 'setup');
    assert.equal(configBody.defaults.channel, 'stable');
    assert.equal(Array.isArray(configBody.network.addresses), true);

    const submit = await httpRequest('http://127.0.0.1:18081/api/setup?token=token-123', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'stable', dnsMode: 'system', repoUrl: 'https://github.com/Nine-Minds/alga-psa.git' })
    });
    assert.equal(submit.statusCode, 202);
    assert.equal(JSON.parse(submit.body).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'setup-inputs.json'), 'utf8')).channel, 'stable');
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'install-state.json'), 'utf8')).status, 'setup-queued');

    const statusPage = await httpGet('http://127.0.0.1:18081/?token=token-123');
    assert.equal(statusPage.statusCode, 200);
    assert.match(statusPage.body, /Status UI/);
  } finally {
    server.kill('SIGTERM');
  }
});
