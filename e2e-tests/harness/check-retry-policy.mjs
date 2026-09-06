import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcilePlaywrightExecution } from '../../scripts/lib/playwright-execution-evidence.mjs';

// Exercise the installed runner and the real production config in a disposable
// test suite. These deliberately failing fixtures are never product journeys.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'alga-playwright-policy-'));
const artifacts = join(root, 'harness-results');
mkdirSync(artifacts, { recursive: true });

function writeFixture(mode) {
  writeFileSync(join(temporary, 'policy.spec.ts'), `
    import { test, expect } from ${JSON.stringify(require.resolve('@playwright/test'))};
    test('browser outcome', async ({ page }, testInfo) => {
      ${mode === 'skipped' ? "test.skip(true, 'deliberate skipped case');" : ''}
      ${mode === 'expected-failure' ? 'test.fail();' : ''}
      await page.setContent('<h1>Browser policy probe</h1>');
      await expect(page.getByRole('heading')).toHaveText('Browser policy probe');
      expect(${mode === 'flaky' ? 'testInfo.retry' : mode === 'expected-failure' ? '0' : '1'}, 'deliberate first-attempt failure').toBe(1);
    });
  `);
}

function execute(label) {
  const output = join(artifacts, label);
  const report = join(output, 'results.json');
  const collectionPath = join(output, 'collected.json');
  writeFileSync(join(temporary, 'playwright.config.ts'), `
    import config from ${JSON.stringify(join(root, 'playwright.config.ts'))};
    export default {
      ...config,
      testDir: ${JSON.stringify(temporary)},
      outputDir: ${JSON.stringify(join(output, 'artifacts'))},
      reporter: [['json', { outputFile: ${JSON.stringify(report)} }]],
    };
  `);
  const invoke = (args, reportPath) => spawnSync(process.execPath, [require.resolve('@playwright/test/cli'),
    'test', '--config', join(temporary, 'playwright.config.ts'), ...args], {
    cwd: root,
    env: { ...process.env, CI: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
      DEBUG: process.env.DEBUG || 'pw:browser' },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const collection = invoke(['--list'], collectionPath);
  assert.equal(collection.status, 0, 'Policy probe must collect');
  const collected = JSON.parse(readFileSync(collectionPath, 'utf8'));
  const result = invoke([], report);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'runner.log'), `${result.stdout || ''}\n${result.stderr || ''}`);
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'Runner must finish normally');
  const parsed = JSON.parse(readFileSync(report, 'utf8'));
  const cases = [];
  function collect(suite) {
    for (const spec of suite.specs || []) cases.push(...spec.tests);
    for (const child of suite.suites || []) collect(child);
  }
  for (const suite of parsed.suites) collect(suite);
  assert.equal(cases.length, 1, 'Exactly one policy probe must execute');
  const evidence = reconcilePlaywrightExecution({ collected, report: parsed, root: temporary, revision: 'disposable-policy-probe', exitCode: result.status });
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  return { result, parsed, test: cases[0], evidence };
}

try {
  writeFixture('passing');
  const passing = execute('passing');
  assert.equal(passing.result.status, 0, 'A first-attempt pass must succeed');
  assert.equal(passing.test.status, 'expected');
  assert.deepEqual(passing.test.results.map(result => result.status), ['passed']);
  assert.equal(passing.evidence.status, 'passed');

  writeFixture('flaky');
  const flaky = execute('flaky');
  assert.equal(flaky.result.status, 1, 'A retry-only pass must fail the command');
  assert.equal(flaky.test.status, 'flaky');
  assert.equal(flaky.parsed.stats.flaky, 1);
  assert.equal(flaky.evidence.status, 'failed');
  assert.equal(flaky.evidence.counts.flaky, 1);
  assert.deepEqual(flaky.test.results.map(result => result.status), ['failed', 'passed']);
  const firstAttempt = flaky.test.results[0];
  assert.match(firstAttempt.error.message, /deliberate first-attempt failure/);
  for (const name of ['trace', 'screenshot', 'video']) {
    const attachment = firstAttempt.attachments.find(item => item.name === name);
    assert.ok(attachment?.path && existsSync(attachment.path), `First attempt must retain ${name}`);
  }
  for (const mode of ['skipped', 'expected-failure']) {
    writeFixture(mode);
    const probe = execute(mode);
    assert.equal(probe.result.status, 0, 'Plain Playwright permits skipped and expected-failure cases');
    assert.equal(probe.evidence.status, 'failed', 'Required execution evidence must reject a non-passing case');
  }
  console.log('Production browser policy verified: first pass succeeds; retry-only pass fails; skipped/expected-failure cases cannot satisfy required execution; first-failure trace, screenshot and video retained.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
