import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyRepositoryInventory, vitestInventoryArtifacts } from '../lib/repository-inventory-artifacts.mjs';

test('same-revision artifact inventory covers every lane and rejects stale, missing, empty and orphaned inputs', t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'repository-inventory-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'artifacts'), revision = 'a'.repeat(40);
  const source = { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } };
  const candidates = [];
  const write = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value)); };
  const add = file => { candidates.push(file); write(path.join(root, file), {}); return file; };
  for (const descriptor of vitestInventoryArtifacts(revision)) {
    const directory = path.join(input, descriptor.directory), file = add(`${descriptor.runner}.test.js`);
    write(path.join(directory, 'collected.json'), [{ file: path.join(root, file) }]);
    write(path.join(directory, 'collected-tests.json'), [{ file: path.join(root, file), name: 'registered case' }]);
    write(path.join(directory, 'evidence.json'), { source });
    if (descriptor.runner === 'mobile') for (const phase of ['before', 'after']) write(path.join(directory, `source-${phase}.json`), source[phase]);
  }
  const nodeFile = add('node.test.mjs');
  writeFileSync(path.join(root, nodeFile), 'import test from "node:test"; test("actual registration", () => {});');
  const reporter = fileURLToPath(new URL('../lib/node-test-reporter.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, nodeFile], {
    cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(run.status, 0, run.stderr);
  for (const artifact of ['node-tooling', 'appliance-node']) {
    const directory = path.join(input, `${artifact}-${revision}`);
    write(path.join(directory, 'evidence.json'), { source, sourceRoot: root, revision, suite: artifact, status: 'passed', expectedFiles: [nodeFile] });
    writeFileSync(path.join(directory, 'events.jsonl'), run.stdout);
  }
  const browserDir = path.join(input, `browser-discovery-${revision}`);
  write(path.join(browserDir, 'evidence.json'), { sourceBefore: source.before, sourceAfter: source.after,
    sourceRoot: root, status: 'passed', executionVerified: false });
  for (const runner of ['teams-development', 'supported-upgrade', 'server-legacy', 'enterprise-legacy', 'enterprise-deploy', 'production-community', 'production-enterprise']) {
    const file = add(`${runner}.spec.js`);
    write(path.join(browserDir, `${runner}.json`), { config: { rootDir: root }, errors: [], suites: [{ file, specs: [{ file,
      title: 'collected browser case', tests: [{ projectId: 'fixture', projectName: 'fixture', expectedStatus: 'passed', results: [] }] }] }] });
  }
  const manualDir = path.join(input, 'manual-test-inventory'), manualFile = add('manual.test.js');
  write(path.join(manualDir, 'evidence.json'), { source, sourceRoot: root, status: 'passed', executionVerified: false });
  write(path.join(manualDir, 'manual', 'collected.json'), [manualFile]);
  write(path.join(manualDir, 'manual', 'collected-tests.json'), [{ file: manualFile, name: 'manual case' }]);
  const manualRunners = [{ runner: 'manual', mandatory: false, owner: 'Fixture owner', runtime: 'Manual',
    reason: 'Reviewed fixture', issue: 'fixture-1', expires: '2999-01-01' }];
  const args = { root, revision, input, candidates, manualRunners, exclusions: [] };
  const check = () => verifyRepositoryInventory(args);
  const valid = check();
  assert.equal(valid.status, 'passed', valid.failures.join('\n'));
  assert.equal(valid.executionVerified, false);
  assert.equal(valid.tests.length, candidates.length);
  assert.equal(valid.runners.find(r => r.runner === 'manual').mandatory, false);
  assert.equal(verifyRepositoryInventory({ ...args, candidates: [...candidates, 'new.test.js'] }).status, 'failed');
  const unitDir = path.join(input, vitestInventoryArtifacts(revision)[0].directory);
  write(path.join(unitDir, 'evidence.json'), { source: { ...source, before: { ...source.before, revision: 'b'.repeat(40) } } });
  assert.ok(check().failures.some(f => f.includes('stale or dirty')));
  write(path.join(unitDir, 'evidence.json'), { source });
  write(path.join(unitDir, 'collected-tests.json'), []);
  assert.ok(check().failures.some(f => f.includes('Empty Vitest collection')));
  rmSync(path.join(unitDir, 'collected.json'));
  assert.ok(check().failures.some(f => f.includes('ENOENT')));
  manualRunners[0].expires = '2000-01-01';
  assert.ok(check().failures.some(f => f.includes('unexpired review')));
});
