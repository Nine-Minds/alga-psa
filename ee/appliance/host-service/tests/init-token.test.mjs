import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const initScript = path.join(repoRoot, 'ee', 'appliance', 'host-service', 'init-token.mjs');

test('init-token creates a persistent human-friendly setup token', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-setup-token-'));
  const tokenFile = path.join(tmp, 'setup-token');

  const env = {
    ...process.env,
    ALGA_APPLIANCE_TOKEN_FILE: tokenFile
  };

  const first = spawnSync('node', [initScript], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(fs.existsSync(tokenFile), true);

  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  assert.match(token, /^\d{4}-\d{4}-\d{4}-\d{4}-\d{4}$/);

  const second = spawnSync('node', [initScript], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(fs.readFileSync(tokenFile, 'utf8').trim(), token);
});
