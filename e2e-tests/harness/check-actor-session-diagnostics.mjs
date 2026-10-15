import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'alga-actor-diagnostics-'));
const artifacts = join(root, 'harness-results', 'actor-sessions');
mkdirSync(artifacts, { recursive: true });

try {
  for (const fails of [true, false]) {
    const output = join(artifacts, fails ? 'failed' : 'passed');
    const report = join(output, 'results.json');
    writeFileSync(join(temporary, 'actor.spec.ts'), `
      import { test, expect } from ${JSON.stringify(join(root, 'fixtures/auth.ts'))};
      test('additional actor diagnostics', async ({ sessions }) => {
        const context = await sessions.create('manager');
        const page = await context.newPage();
        await page.goto('data:text/html,<h1>Manager session</h1>');
        await expect(page.getByRole('heading')).toHaveText('Manager session');
        await expect(async () => {
          expect((await page.screenshot()).length).toBeGreaterThan(0);
        }).toPass({ timeout: 10000 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(${fails ? '0' : '1'}, 'intentional manager assertion').toBe(1);
      });
    `);
    writeFileSync(join(temporary, 'playwright.config.ts'), `
      import config from ${JSON.stringify(join(root, 'playwright.config.ts'))};
      export default { ...config, testDir: ${JSON.stringify(temporary)}, retries: 0,
        outputDir: ${JSON.stringify(join(output, 'artifacts'))},
        reporter: [['json', { outputFile: ${JSON.stringify(report)} }]] };
    `);
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
      '--config', join(temporary, 'playwright.config.ts')], {
      cwd: root, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CI: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: report },
    });
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'runner.log'), `${result.stdout || ''}\n${result.stderr || ''}`);
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, fails ? 1 : 0);
    const parsed = JSON.parse(readFileSync(report, 'utf8'));
    const cases = [];
    const collect = suite => {
      for (const spec of suite.specs || []) cases.push(...spec.tests);
      for (const child of suite.suites || []) collect(child);
    };
    parsed.suites.forEach(collect);
    assert.equal(cases.length, 1);
    assert.equal(cases[0].results.length, 1);
    const attempt = cases[0].results[0];
    assert.equal(attempt.status, fails ? 'failed' : 'passed');
    if (fails) {
      assert.match(attempt.error.message, /intentional manager assertion/);
      for (const name of ['trace', 'manager-0-screenshot', 'manager-0-video']) {
        const attachment = attempt.attachments.find(item => item.name === name);
        assert.ok(attachment?.path && existsSync(attachment.path), `Missing actor diagnostic: ${name}`);
      }
    } else {
      assert.equal(attempt.attachments.filter(item => item.name.startsWith('manager-')).length, 0);
    }
  }
  console.log('Actor sessions retain trace, screenshot and video on failure and discard diagnostics on success.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
