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
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

test('T003 first-boot smoke: console output and host web service health', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-t003-'));
  const tokenFile = path.join(tmp, 'setup-token');
  fs.writeFileSync(tokenFile, 'token-123\n');

  const consoleResult = await new Promise((resolve) => {
    const child = spawn('node', [consoleScript], {
      cwd: repoRoot,
      env: { ...process.env, ALGA_APPLIANCE_TOKEN_FILE: tokenFile, ALGA_APPLIANCE_PORT: '18080' },
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
  assert.match(consoleResult.stdout, /Console setup fallback:/);

  const server = spawn('node', [serverScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ALGA_APPLIANCE_PORT: '18081',
      ALGA_APPLIANCE_TOKEN_FILE: tokenFile,
      ALGA_APPLIANCE_STATE_FILE: path.join(tmp, 'install-state.json'),
      ALGA_APPLIANCE_SETUP_INPUTS_FILE: path.join(tmp, 'setup-inputs.json')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const health = await httpGet('http://127.0.0.1:18081/healthz');
    assert.equal(health.statusCode, 200);
    assert.match(health.body, /"ok":true/);
  } finally {
    server.kill('SIGTERM');
  }
});
