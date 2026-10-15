import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectIntegration, readChangedFiles } from '../lib/integration-selection.mjs';

test('only known documentation can skip integration coverage', () => {
  assert.equal(selectIntegration(['docs/testing.md', 'ee/docs/plans/p/features.json']).shouldRun, false);
  assert.equal(selectIntegration(['README.md', 'packages/billing/src/actions/usageActions.ts']).shouldRun, true);
  assert.equal(selectIntegration(['new-runtime/handler.ts']).full, true);
  assert.equal(selectIntegration(['docs/runtime.js']).full, true);
  assert.equal(selectIntegration(['packages/billing/src/actions/usageActions.ts']).full, false);
});

test('unknown evidence and non-graph inputs require full coverage', () => {
  assert.equal(selectIntegration(null).full, true);
  for (const file of [
    'package-lock.json', 'package.json', 'tsconfig.base.json', '.env.localtest',
    'scripts/run-tier1-integration.mjs', '.github/workflows/integration-tests.yml',
    'services/email-service/src/consumer.ts', 'ee/packages/workflows/src/actions/run.ts',
    'server/migrations/next.cjs', 'server/seeds/dev/01.cjs', 'server/test-utils/dbConfig.ts',
    'server/vitest.config.ts', 'server/src/test/setup.ts', 'shared/vitest.config.ts',
    'packages/billing/vitest.config.ts', 'shared/workflow/runtime/actions/__tests__/_dbTestUtils.ts',
  ]) assert.equal(selectIntegration([file]).full, true, file);
});

test('actual git diffs preserve both sides of moves and recover conservatively from missing revisions', (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'integration-selection-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(cwd, 'README.md'), 'Initial\n');
  git('add', '.'); git('commit', '-qm', 'initial');
  let base = git('rev-parse', 'HEAD');
  for (const file of ['package-lock.json', 'services/email-service/src/consumer.ts', 'ee/packages/workflows/src/run.ts']) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), '{}\n');
    git('add', '.'); git('commit', '-qm', file);
    const changed = readChangedFiles({ cwd, base });
    assert.deepEqual(changed, [file]);
    assert.equal(selectIntegration(changed).full, true);
    base = git('rev-parse', 'HEAD');
  }
  git('mv', 'services/email-service/src/consumer.ts', 'services/email-service/src/moved.ts');
  git('commit', '-qm', 'move');
  assert.deepEqual(readChangedFiles({ cwd, base }), ['services/email-service/src/consumer.ts', 'services/email-service/src/moved.ts']);
  for (const badBase of [undefined, '0000000000', 'missing-ref', '--help']) {
    assert.equal(selectIntegration(readChangedFiles({ cwd, base: badBase })).full, true);
  }
  assert.equal(readChangedFiles({ cwd, base, head: 'missing-head' }), null);
});
