import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { discoverBrowserTests } from '../lib/browser-test-discovery.mjs';

const cli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
const playwright = fileURLToPath(new URL('../../node_modules/@playwright/test/index.js', import.meta.url));

test('real Playwright discovery catches additions, moves, empty files and broken imports without running tests', t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'browser-discovery-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  };
  execFileSync('git', ['init', '-q'], { cwd: root });
  write('playwright.config.cjs', "module.exports = { testDir: './covered', testMatch: '**/*.playwright.test.js' };\n");
  const body = `const {test}=require(${JSON.stringify(playwright)}); test('collection must not execute this body',()=>{throw new Error('must not execute')});`;
  write('covered/base.playwright.test.js', body);
  const collect = () => {
    const invocation = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(root, 'collection.json') },
    });
    assert.equal(invocation.error, undefined);
    return { runner: 'actual-playwright', exitCode: invocation.status,
      report: JSON.parse(readFileSync(path.join(root, 'collection.json'), 'utf8')) };
  };
  let report = collect();
  assert.equal(report.exitCode, 0);
  assert.equal(discoverBrowserTests(root, [report]).status, 'passed');
  assert.equal(discoverBrowserTests(root, [report]).executionVerified, false);
  write('e2e-tests/upgrade-tests/retained.spec.js', body);
  assert.deepEqual(discoverBrowserTests(root, [collect()]).unmatched, ['e2e-tests/upgrade-tests/retained.spec.js']);
  rmSync(path.join(root, 'e2e-tests/upgrade-tests/retained.spec.js'));
  write('outside/new.playwright.test.js', body);
  assert.deepEqual(discoverBrowserTests(root, [collect()]).unmatched, ['outside/new.playwright.test.js']);
  renameSync(path.join(root, 'covered/base.playwright.test.js'), path.join(root, 'outside/moved.playwright.test.js'));
  assert.match(discoverBrowserTests(root, [report]).failures.join('\n'), /outside candidate inventory/);
  write('playwright.config.cjs', "module.exports = { testDir: '.', testMatch: '**/*.playwright.test.js' };\n");
  report = collect();
  assert.equal(discoverBrowserTests(root, [report]).status, 'passed');
  write('outside/new.playwright.test.js', body.replace("test('collection", "test.skip('collection"));
  const disabled = discoverBrowserTests(root, [collect()]);
  assert.equal(disabled.status, 'passed'); // Collection success is not execution success.
  assert.equal(disabled.executionVerified, false);
  assert.equal(disabled.collections[0].disabledOrExpectedFailure, 1);
  write('outside/empty.playwright.test.js', '// No tests registered.');
  assert.deepEqual(discoverBrowserTests(root, [collect()]).unmatched, ['outside/empty.playwright.test.js']);
  write('outside/empty.playwright.test.js', "require('./missing-dependency');");
  report = collect();
  assert.notEqual(report.exitCode, 0);
  assert.throws(() => discoverBrowserTests(root, [report]), /collection or runtime errors/);
});
