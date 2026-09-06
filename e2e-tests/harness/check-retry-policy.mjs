import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the installed runner and the real production config in a disposable
// test suite. These deliberately failing fixtures are never product journeys.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'alga-playwright-policy-'));
const artifacts = join(root, 'harness-results');
mkdirSync(artifacts, { recursive: true });

function writeFixture(flaky) {
  writeFileSync(join(temporary, 'policy.spec.ts'), `
    import { test, expect } from ${JSON.stringify(require.resolve('@playwright/test'))};
    test('browser outcome', async ({ page }, testInfo) => {
      await page.setContent('<h1>Browser policy probe</h1>');
      await expect(page.getByRole('heading')).toHaveText('Browser policy probe');
      expect(${flaky ? 'testInfo.retry' : '1'}, 'deliberate first-attempt failure').toBe(1);
    });
  `);
}

function execute(label) {
  const output = join(artifacts, label);
  const report = join(output, 'results.json');
  writeFileSync(join(temporary, 'playwright.config.ts'), `
    import config from ${JSON.stringify(join(root, 'playwright.config.ts'))};
    export default {
      ...config,
      testDir: ${JSON.stringify(temporary)},
      outputDir: ${JSON.stringify(join(output, 'artifacts'))},
      reporter: [['json', { outputFile: ${JSON.stringify(report)} }]],
    };
  `);
  const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'),
    'test', '--config', join(temporary, 'playwright.config.ts')], {
    cwd: root,
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
    timeout: 180_000,
  });
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
  return { result, parsed, test: cases[0] };
}

try {
  writeFixture(false);
  const passing = execute('passing');
  assert.equal(passing.result.status, 0, 'A first-attempt pass must succeed');
  assert.equal(passing.test.status, 'expected');
  assert.deepEqual(passing.test.results.map(result => result.status), ['passed']);

  writeFixture(true);
  const flaky = execute('flaky');
  assert.equal(flaky.result.status, 1, 'A retry-only pass must fail the command');
  assert.equal(flaky.test.status, 'flaky');
  assert.equal(flaky.parsed.stats.flaky, 1);
  assert.deepEqual(flaky.test.results.map(result => result.status), ['failed', 'passed']);
  const firstAttempt = flaky.test.results[0];
  assert.match(firstAttempt.error.message, /deliberate first-attempt failure/);
  for (const name of ['trace', 'screenshot', 'video']) {
    const attachment = firstAttempt.attachments.find(item => item.name === name);
    assert.ok(attachment?.path && existsSync(attachment.path), `First attempt must retain ${name}`);
  }
  console.log('Production browser policy verified: first pass succeeds; retry-only pass fails; first-failure trace, screenshot and video retained.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
