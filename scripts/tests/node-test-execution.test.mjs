import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { reconcileNodeExecution } from '../lib/node-test-execution.mjs';

const reporter = fileURLToPath(new URL('../lib/node-test-reporter.mjs', import.meta.url));
function run(t, sources, flags = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'node-execution-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = sources.map((source, index) => {
    const file = `example-${index}.test.mjs`;
    fs.writeFileSync(path.join(root, file), source);
    return file;
  });
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=2000', `--test-reporter=${reporter}`, ...flags, ...files], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  const events = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const input = { root, files, events, exitCode: result.status, suite: 'fixture', revision: 'fixture' };
  return { input, evidence: reconcileNodeExecution(input) };
}

test('Node evidence reconciles separate files, nested suites and dynamic subtests from actual runner events', (t) => {
  const { input, evidence } = run(t, [
    "import { describe, test } from 'node:test'; describe('suite', () => { test('outer', async t => { await t.test('dynamic', () => {}); }); });",
    "import test from 'node:test'; test('another file', () => {});",
  ]);
  assert.equal(evidence.status, 'passed', evidence.failures.join('\n'));
  assert.equal(evidence.counts.tests, 3);
  assert.deepEqual(evidence.executedFiles, input.files);
  assert.deepEqual(evidence.tests.map(({ file, name }) => [file, name]), [
    [input.files[0], 'dynamic'], [input.files[0], 'outer'], [input.files[1], 'another file'],
  ]);
  const missingFile = reconcileNodeExecution({ ...input, files: [...input.files, 'omitted.test.mjs'] });
  assert.equal(missingFile.status, 'failed');
  assert.ok(missingFile.failures.some((failure) => failure.includes('Missing completed file')));
  for (const drop of ['test:pass', 'test:summary']) {
    const damaged = reconcileNodeExecution({ ...input, events: input.events.filter(({ type }) => type !== drop) });
    assert.equal(damaged.status, 'failed');
  }
});

for (const [name, source] of [
  ['empty file', 'export const unused = true;'],
  ['skip', "import test from 'node:test'; test.skip('skipped', () => {});"],
  ['todo', "import test from 'node:test'; test.todo('later');"],
  ['assertion failure', "import test from 'node:test'; test('fails', () => { throw new Error('intentional failure'); });"],
  ['premature success exit', "import test from 'node:test'; test('unfinished', () => { process.exit(0); });"],
  ['load failure', "throw new Error('load failed');"],
  ['cancelled test', "import test from 'node:test'; test('cancelled', { signal: AbortSignal.abort() }, () => {});"],
]) {
  test(`Node evidence refuses ${name}`, (t) => {
    const { evidence } = run(t, [source]);
    assert.equal(evidence.status, 'failed', JSON.stringify(evidence));
  });
}
