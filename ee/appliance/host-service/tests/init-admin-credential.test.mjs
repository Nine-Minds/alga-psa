import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const initScript = path.join(repoRoot, 'ee', 'appliance', 'host-service', 'init-admin-credential.mjs');

test('init-admin-credential creates a persistent temporary admin password state', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-admin-credential-'));
  const passwordFile = path.join(tmp, 'admin-password');
  const stateFile = path.join(tmp, 'admin-password-state.json');

  const env = {
    ...process.env,
    ALGA_APPLIANCE_ADMIN_CREDENTIAL_DRY_RUN: '1',
    ALGA_APPLIANCE_ADMIN_USER: 'alga-admin',
    ALGA_APPLIANCE_ADMIN_PASSWORD_FILE: passwordFile,
    ALGA_APPLIANCE_ADMIN_PASSWORD_STATE_FILE: stateFile
  };

  const first = spawnSync('node', [initScript], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(fs.existsSync(passwordFile), true);
  assert.equal(fs.existsSync(stateFile), true);

  const password = fs.readFileSync(passwordFile, 'utf8').trim();
  assert.match(password, /^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/);

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'temporary');
  assert.equal(state.user, 'alga-admin');
  assert.equal(state.changeRequired, true);

  const second = spawnSync('node', [initScript], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(fs.readFileSync(passwordFile, 'utf8').trim(), password);
});

test('init-admin-credential serializes concurrent boot-time initializers', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-admin-credential-race-'));
  const passwordFile = path.join(tmp, 'admin-password');
  const stateFile = path.join(tmp, 'admin-password-state.json');
  const lockDir = path.join(tmp, 'admin-credential.lock');

  const env = {
    ...process.env,
    ALGA_APPLIANCE_ADMIN_CREDENTIAL_DRY_RUN: '1',
    ALGA_APPLIANCE_ADMIN_CREDENTIAL_TEST_DELAY_MS: '300',
    ALGA_APPLIANCE_ADMIN_USER: 'alga-admin',
    ALGA_APPLIANCE_ADMIN_PASSWORD_FILE: passwordFile,
    ALGA_APPLIANCE_ADMIN_PASSWORD_STATE_FILE: stateFile,
    ALGA_APPLIANCE_ADMIN_CREDENTIAL_LOCK_DIR: lockDir
  };

  const run = () => new Promise((resolve) => {
    const child = spawn('node', [initScript], { cwd: repoRoot, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });

  const [first, second] = await Promise.all([run(), run()]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  assert.equal(fs.existsSync(passwordFile), true);
  assert.equal(fs.existsSync(stateFile), true);
  assert.equal(fs.existsSync(lockDir), false);

  const password = fs.readFileSync(passwordFile, 'utf8').trim();
  assert.match(password, /^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/);

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'temporary');
  assert.equal(state.passwordFile, passwordFile);
});
