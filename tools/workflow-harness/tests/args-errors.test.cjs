const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.resolve(__dirname, '..', 'run.cjs');

function runHarnessCli(args, env = {}) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('T001: fails with clear error when --test is missing', () => {
  const res = runHarnessCli(['--base-url', 'http://localhost:3010', '--tenant', 'tenant', '--cookie', 'cookie']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Missing --test/);
});

