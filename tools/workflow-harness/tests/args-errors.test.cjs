const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

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

test('T002: fails with clear error when bundle.json is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-harness-missing-bundle-'));
  fs.writeFileSync(path.join(dir, 'test.cjs'), 'module.exports = async () => {};', 'utf8');

  const res = runHarnessCli([
    '--test',
    dir,
    '--base-url',
    'http://localhost:3010',
    '--tenant',
    'tenant',
    '--cookie',
    'cookie'
  ]);

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Missing required fixture file:/);
  assert.match(res.stderr, /bundle\.json/);
});

test('T003: fails with clear error when test.cjs is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-harness-missing-test-'));
  fs.writeFileSync(path.join(dir, 'bundle.json'), '{}', 'utf8');

  const res = runHarnessCli([
    '--test',
    dir,
    '--base-url',
    'http://localhost:3010',
    '--tenant',
    'tenant',
    '--cookie',
    'cookie'
  ]);

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Missing required fixture file:/);
  assert.match(res.stderr, /test\.cjs/);
});
