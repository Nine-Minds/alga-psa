import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const vitest = path.join(repository, 'server/node_modules/vitest/vitest.mjs');

test('workflow selector and real integration runner agree on git changes and widen on graph failure', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  // Exercise the production entry points in a disposable repository. The
  // runner shim delegates every invocation to the installed Vitest binary;
  // its optional failure models an unavailable affected-test graph only.
  for (const file of ['scripts/select-integration-tests.mjs', 'scripts/run-tier1-integration.mjs', 'scripts/lib/integration-selection.mjs', 'scripts/lib/test-execution-evidence.mjs', 'scripts/lib/test-discovery.mjs', 'scripts/lib/test-revision.mjs']) {
    write(file, '');
    copyFileSync(path.join(repository, file), path.join(root, file));
  }
  write('server/node_modules/vitest/vitest.mjs', `
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === 'run' && existsSync(${JSON.stringify(path.join(root, 'report-failure'))})) process.exit(0);
if (args[0] === 'list' && args.includes('--changed') && existsSync(${JSON.stringify(path.join(root, 'graph-failure'))})) process.exit(1);
const result = spawnSync(process.execPath, [${JSON.stringify(vitest)}, ...args], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  write('.gitignore', 'node_modules/\noutput/\ngraph-failure\nreport-failure\ntest-results/\nserver/test-results-integration.json\n');
  write('server/vitest.config.mjs', 'export default {test:{include:["src/test/integration/**/*.test.js"],globals:true,maxWorkers:1,fileParallelism:false}};');
  write('server/package.json', '{"type":"module"}');
  write('server/src/test/integration/tier1.manifest.json', JSON.stringify({ paths: ['src/test/integration/floor.test.js'] }));
  write('server/src/value.js', 'export const value = 1;');
  write('server/src/test/integration/floor.test.js', "test('critical floor', () => expect(2 + 2).toBe(4));");
  write('server/src/test/integration/affected.test.js', "import {value} from '../../value.js'; test('reads changed dependency', () => expect(value).toBeGreaterThan(0));");
  write('server/src/test/integration/other.test.js', "test('additional integration', () => expect('saved').toBe('saved'));");
  mkdirSync(path.join(root, 'output'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture change'); return git('rev-parse', 'HEAD'); };
  let base = commit();
  const run = (script, env, args = []) => spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, TIER1_BASE_SHA: base, TIER1_HEAD_SHA: 'HEAD', ...env },
  });
  const select = (env = {}) => {
    const output = path.join(root, 'output/workflow-output');
    writeFileSync(output, '');
    const result = run('scripts/select-integration-tests.mjs', { ...env, GITHUB_OUTPUT: output });
    assert.equal(result.status, 0, result.stderr);
    const decision = JSON.parse(result.stdout.trim());
    assert.equal(readFileSync(output, 'utf8'), `should_run=${decision.shouldRun}\nfull=${decision.full}\n`);
    return decision;
  };
  const execute = (env = {}) => {
    const report = path.join(root, 'output/results.json');
    writeFileSync(report, 'null');
    const result = run('scripts/run-tier1-integration.mjs', env, ['--reporter=json', `--outputFile=${report}`]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const execution = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(execution.success, true);
    assert.equal(execution.numPendingTests, 0);
    const evidence = JSON.parse(readFileSync(path.join(root, 'test-results/integration/evidence.json'), 'utf8'));
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.counts.passed, execution.numTotalTests);
    assert.equal(evidence.expectedTests.length, execution.numTotalTests);
    return execution.testResults.map((file) => path.basename(file.name)).sort();
  };
  const full = ['affected.test.js', 'floor.test.js', 'other.test.js'];
  for (const [file, content] of [
    ['package-lock.json', '{}'],
    ['server/src/test/setup.ts', 'export {};'],
    ['server/migrations/fixture.cjs', 'module.exports = {};'],
    ['scripts/selection-input.mjs', 'export const changed = true;'],
    ['services/email-service/src/consumer.ts', 'export {};'],
    ['ee/packages/workflows/src/run.ts', 'export {};'],
  ]) {
    write(file, content); commit();
    assert.equal(select().full, true, file);
    assert.deepEqual(execute(), full, file);
    base = git('rev-parse', 'HEAD');
  }
  write('server/src/value.js', 'export const value = 2;'); commit();
  assert.equal(select().full, false);
  assert.deepEqual(execute(), ['affected.test.js', 'floor.test.js']);
  write('graph-failure', 'simulate unavailable dependency graph');
  assert.deepEqual(execute(), full);
  rmSync(path.join(root, 'graph-failure'));
  for (const env of [{ TIER1_BASE_SHA: '' }, { TIER1_BASE_SHA: 'missing-ref' }, { TIER1_HEAD_SHA: 'missing-head' }]) {
    assert.equal(select(env).full, true);
    assert.deepEqual(execute(env), full);
  }
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  write('output/bin/git', `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
if (process.argv[2] === 'diff') process.exit(128);
const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  chmodSync(path.join(root, 'output/bin/git'), 0o755);
  const unavailableDiff = { PATH: `${path.join(root, 'output/bin')}${path.delimiter}${process.env.PATH}` };
  assert.equal(select(unavailableDiff).full, true);
  assert.deepEqual(execute(unavailableDiff), full);
  base = git('rev-parse', 'HEAD');
  write('docs/testing.md', 'Documentation change'); commit();
  assert.equal(select().shouldRun, false);
  assert.deepEqual(execute(), ['floor.test.js']); // direct invocation preserves the floor
  write('server/src/test/integration/floor.test.js', "test('critical floor', () => expect(2 + 2).toBe(4)); test.skip('unexecuted safety check', () => expect(true).toBe(true));");
  const skipped = run('scripts/run-tier1-integration.mjs', {});
  assert.equal(skipped.status, 1, skipped.stdout + skipped.stderr);
  const evidence = JSON.parse(readFileSync(path.join(root, 'test-results/integration/evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.counts.passed, 1);
  assert.equal(evidence.counts.skipped + evidence.counts.pending, 1);
  assert.ok(evidence.failures.some(message => /skipped:|pending:/.test(message)));
  write('report-failure', 'runner exits successfully without an execution report');
  const noReport = run('scripts/run-tier1-integration.mjs', {});
  assert.equal(noReport.status, 1);
  const missingEvidence = JSON.parse(readFileSync(path.join(root, 'test-results/integration/evidence.json'), 'utf8'));
  assert.ok(missingEvidence.failures.includes('Missing execution report'));
  rmSync(path.join(root, 'report-failure'));
  git('mv', 'server/src/test/integration/floor.test.js', 'server/src/test/integration/moved.test.js');
  const moved = run('scripts/run-tier1-integration.mjs', {});
  assert.notEqual(moved.status, 0);
  assert.match(moved.stderr, /entries not found/);
  assert.equal(JSON.parse(readFileSync(path.join(root, 'test-results/integration/evidence.json'), 'utf8')), null);
  write('server/src/test/integration/tier1.manifest.json', '{"paths":[]}');
  assert.notEqual(run('scripts/run-tier1-integration.mjs', {}).status, 0);
  mkdirSync(path.join(root, 'server/src/test/integration/empty'));
  write('server/src/test/integration/tier1.manifest.json', '{"paths":["src/test/integration/empty"]}');
  const empty = run('scripts/run-tier1-integration.mjs', { TIER1_BASE_SHA: '' });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /floor entry collects no tests/);
});
