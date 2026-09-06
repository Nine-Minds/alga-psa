import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { reconcileDiscovery, repositoryTestFiles } from '../lib/test-discovery.mjs';
import { reconcileExecution } from '../lib/test-execution-evidence.mjs';
import { testRevision } from '../lib/test-revision.mjs';

const vitest = fileURLToPath(new URL('../../server/node_modules/vitest/vitest.mjs', import.meta.url));

test('actual Vitest collection detects additions/moves, and repaired collection executes every identity', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const config = (include) => write('vitest.config.mjs', `export default ${JSON.stringify({ test: { include, globals: true, maxWorkers: 1, fileParallelism: false } })};`);
  const invoke = (args) => execFileSync(process.execPath, [vitest, ...args], { cwd: root, encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
  const collect = () => {
    invoke(['list', '--filesOnly', '--json=collected.json']);
    return JSON.parse(readFileSync(path.join(root, 'collected.json'), 'utf8'));
  };
  const inspect = (files) => reconcileDiscovery({ root, candidates: repositoryTestFiles(root), collections: [{ runner: 'fixture-vitest', status: 'passed', files }] });
  git('init', '-q');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('.gitignore', 'node_modules/\ncollected.json\ntests.json\nresults.json\n');
  config(['covered/**/*.test.js']);
  write('covered/base.test.js', "test('keeps the floor', () => expect(1 + 1).toBe(2));\n");
  git('add', '.'); git('commit', '-qm', 'fixture');
  const before = testRevision(root);
  assert.equal(before.dirty, false);
  assert.equal(inspect(collect()).status, 'passed');

  write('outside/added.test.js', "test('new boundary', () => expect('saved').toBe('saved'));\n");
  assert.deepEqual(inspect(collect()).unmatched, ['outside/added.test.js']);
  config(['covered/**/*.test.js', 'outside/**/*.test.js']);
  assert.equal(inspect(collect()).status, 'passed');
  git('add', '.'); git('commit', '-qm', 'include addition');
  mkdirSync(path.join(root, 'moved'));
  git('mv', 'covered/base.test.js', 'moved/base.test.js');
  assert.deepEqual(inspect(collect()).unmatched, ['moved/base.test.js']);
  const after = testRevision(root);
  assert.equal(after.dirty, true);
  assert.deepEqual(after.changes, [{ status: 'R ', file: 'moved/base.test.js', from: 'covered/base.test.js' }]);
  config(['**/*.test.js']);
  const collected = collect();
  assert.equal(inspect(collected).status, 'passed');
  invoke(['list', '--json=tests.json']);
  invoke(['run', '--reporter=json', '--outputFile=results.json']);
  const evidence = reconcileExecution({
    root, suite: 'fixture-vitest', revision: after.revision, exitCode: 0, collected,
    collectedTests: JSON.parse(readFileSync(path.join(root, 'tests.json'), 'utf8')),
    report: JSON.parse(readFileSync(path.join(root, 'results.json'), 'utf8')),
  });
  assert.equal(evidence.status, 'passed', evidence.failures.join('\n'));
  assert.equal(evidence.counts.passed, 2);
  config(['missing/**/*.test.js']);
  assert.equal(inspect(collect()).status, 'failed');
});
