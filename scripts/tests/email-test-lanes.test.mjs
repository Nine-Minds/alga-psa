import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const vitest = path.join(repository, 'node_modules/vitest/vitest.mjs');

test('email unit runner executes unit suites without loading database suites', { timeout: 60000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-email-test-lanes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src/nested'), { recursive: true });
  const unitFiles = ['src/ordinary.test.ts', 'src/nested/ordinary.test.tsx'];
  for (const file of unitFiles) {
    writeFileSync(path.join(root, file), `test('runs without infrastructure', () => expect(2 + 2).toBe(4));`);
  }
  for (const file of ['src/live.db.test.ts', 'src/nested/live.db.test.tsx']) {
    // Database suites must not even be imported by this runner: their module
    // setup can require infrastructure before any test or skip guard runs.
    writeFileSync(path.join(root, file), `throw new Error('Database suite loaded in the unit lane');`);
  }
  const report = path.join(root, 'results.json');
  const result = spawnSync(process.execPath, [vitest, 'run',
    '--config', path.join(repository, 'packages/email/vitest.config.ts'),
    '--root', root, '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${report}`,
  ], { cwd: repository, encoding: 'utf8', timeout: 30000, env: { ...process.env, CI: '1' } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const results = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(results.numPassedTests, unitFiles.length);
  assert.deepEqual(results.testResults.map((suite) => path.relative(root, suite.name)).sort(), unitFiles.sort());
});

test('workspace database runner collects the live email quota regressions', { timeout: 60000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-email-db-collection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const collected = path.join(root, 'collected.json');
  const suite = 'packages/email/src/__tests__/TenantEmailService.rateLimit.concurrency.db.test.ts';
  const result = spawnSync(process.execPath, [vitest, 'list',
    '--config', 'vitest.workspace-db.config.ts', path.basename(suite),
    '--filesOnly', `--json=${collected}`,
  ], { cwd: path.join(repository, 'server'), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CI: '1' } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(collected, 'utf8'))
    .map((entry) => path.relative(repository, entry.file)), [suite]);
});
