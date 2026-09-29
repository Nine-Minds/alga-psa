import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { verifyNodeWorkflow } from '../verify-node-workflow.mjs';

test('aggregate rechecks real Node events and Playwright collections instead of trusting passed manifests', t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'node-workflow-gate-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  execFileSync('git', ['init', '-q'], { cwd: root });
  write('.gitignore', 'test-results/\n');
  write('scripts/node-test-exclusions.json', []);
  const revision = 'a'.repeat(40);
  const input = path.join(root, 'test-results/input');
  const source = { revision, dirty: false, changes: [] };
  const common = { status: 'passed', failures: [], sourceRoot: root,
    source: { before: source, after: source }, sourceBefore: source, sourceAfter: source, selection: { mode: 'full' } };
  const jobs = Object.fromEntries(['node-tooling', 'appliance', 'browser-discovery'].map(id => [id, { result: 'success' }]));
  const artifacts = {};
  for (const [id, artifact, file] of [
    ['node-tooling', 'node-tooling', 'scripts/tests/example.test.mjs'],
    ['appliance', 'appliance-node', 'ee/appliance/example.test.mjs'],
  ]) {
    write(file, "import test from 'node:test'; test('real behavior', () => {});\n");
    const reporter = fileURLToPath(new URL('../lib/node-test-reporter.mjs', import.meta.url));
    const run = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, file], {
      cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(run.status, 0, run.stderr);
    const directory = `test-results/input/${artifact}-${revision}`;
    write(`${directory}/evidence.json`, common);
    write(`${directory}/events.jsonl`, run.stdout);
    artifacts[id] = { directory, events: run.stdout };
  }
  const playwright = fileURLToPath(new URL('../../node_modules/@playwright/test/index.js', import.meta.url));
  const cli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
  write('e2e-tests/tests/example.spec.js', `const {test}=require(${JSON.stringify(playwright)}); test('browser collection',()=>{throw new Error('do not execute')});`);
  write('playwright.config.cjs', "module.exports={testDir:'./e2e-tests/tests'};");
  const reportFile = path.join(root, 'test-results/browser.json');
  const run = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
    cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const browser = `test-results/input/browser-discovery-${revision}`;
  write(`${browser}/evidence.json`, common);
  const runners = ['teams-development', 'supported-upgrade', 'server-legacy', 'enterprise-legacy', 'enterprise-deploy', 'production-community', 'production-enterprise'];
  for (const runner of runners) write(`${browser}/${runner}.json`, report);
  const check = () => verifyNodeWorkflow({ root, revision, input, jobs });
  assert.equal(check().status, 'passed', check().failures.join('\n'));
  assert.equal(check().results.find(item => item.id === 'browser-discovery').executionVerified, false);
  for (const id of Object.keys(jobs)) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      jobs[id] = { result };
      assert.equal(check().status, 'failed', `${id}/${result}`);
    }
    jobs[id] = { result: 'success' };
  }
  for (const { directory, events } of Object.values(artifacts)) {
    write(`${directory}/events.jsonl`, events.split('\n').filter(line => !line.includes('test:summary')).join('\n'));
    assert.equal(check().status, 'failed');
    write(`${directory}/events.jsonl`, events);
    write(`${directory}/evidence.json`, { ...common, source: { before: { ...source, revision: 'b'.repeat(40) }, after: source } });
    assert.equal(check().status, 'failed');
    write(`${directory}/evidence.json`, common);
  }
  for (const sourcePatch of [{ dirty: true, changes: [{ file: 'changed', status: ' M' }] }, { changes: undefined }]) {
    write(`${browser}/evidence.json`, { ...common, sourceAfter: { ...source, ...sourcePatch } });
    assert.equal(check().status, 'failed');
  }
  write(`${browser}/evidence.json`, common);
  write('scripts/tests/manual.test.mjs', '// Owned manual fixture');
  write('scripts/node-test-exclusions.json', [{ file: 'scripts/tests/manual.test.mjs', owner: 'test-owner',
    reason: 'Owned manual fixture', issue: 'https://example.test/issue/1', expires: '2000-01-01' }]);
  assert.equal(check().status, 'failed');
  assert.ok(check().failures.some(failure => failure.includes('Expired or invalid exclusion')));
  write('scripts/node-test-exclusions.json', [{ file: 'scripts/tests/manual.test.mjs', owner: 'test-owner',
    reason: 'Owned manual fixture', issue: 'https://example.test/issue/1', expires: '2100-01-01' }]);
  assert.equal(check().status, 'passed');
  write('scripts/node-test-exclusions.json', []);
  rmSync(path.join(root, 'scripts/tests/manual.test.mjs'));
  for (const runner of runners) {
    write(`${browser}/${runner}.json`, { ...report, suites: [] });
    assert.equal(check().status, 'failed', `empty mandatory runner ${runner}`);
    write(`${browser}/${runner}.json`, report);
  }
  write('scripts/tests/omitted.test.mjs', "import test from 'node:test'; test('omitted',()=>{});");
  assert.equal(check().status, 'failed');
  rmSync(path.join(root, 'scripts/tests/omitted.test.mjs'));
  write(`${browser}/production-enterprise.json`, '{truncated');
  assert.equal(check().status, 'failed');
  write(`${browser}/production-enterprise.json`, report);
  rmSync(path.join(root, artifacts.appliance.directory, 'events.jsonl'));
  assert.equal(check().status, 'failed');
});
