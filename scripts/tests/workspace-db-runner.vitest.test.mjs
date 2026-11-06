import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('workspace DB runner collects and executes app-credential opt-in suites with their isolated application connection', { timeout: 60000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-workspace-db-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts/lib', 'server', 'packages/email', 'packages/billing']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const file of ['scripts/run-workspace-db-tests.mjs', 'scripts/lib/test-discovery.mjs',
    'scripts/lib/test-execution-evidence.mjs', 'scripts/lib/test-revision.mjs']) {
    cpSync(path.join(repository, file), path.join(root, file));
  }
  symlinkSync(path.join(repository, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  // The runner launches the hoisted root vitest, as every other lane does.
  symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest-results/\n');
  writeFileSync(path.join(root, 'server/vitest.workspace-db.config.ts'), `export default ${JSON.stringify({
    test: { include: ['../packages/**/*.db.test.ts'], globals: true, environment: 'node', maxWorkers: 1 },
  })};`);
  // Exercise the same opt-in boundary as the real suite through both Vitest
  // collection and execution, without needing a database for this runner test.
  writeFileSync(path.join(root, 'packages/email/outbound.db.test.ts'), `
    const suite = process.env.OUTBOUND_DIAG_DB_TESTS === '1' ? describe : describe.skip;
    suite('outbound diagnostics', () => {
      it('uses the migrated application database', () => {
        expect(process.env.OUTBOUND_DIAG_DB_HOST).toBe('127.0.0.2');
        expect(process.env.OUTBOUND_DIAG_DB_PORT).toBe('15432');
        expect(process.env.OUTBOUND_DIAG_DB_USER).toBe('fixture_app');
        expect(process.env.OUTBOUND_DIAG_DB_PASSWORD).toBe('fixture_password');
        expect(process.env.OUTBOUND_DIAG_DB_NAME).toBe('fixture_database');
        expect(process.env.HOUR_BLOCK_DB_NAME).toBe('fixture_database');
        expect(process.env.TEST_DB_NAME).toBe('fixture_database');
      });
    });
  `);
  writeFileSync(path.join(root, 'packages/billing/contractLineSave.db.test.ts'), `
    describe.runIf(process.env.CONTRACT_LINE_SAVE_DB_TESTS === '1')('contract line save', () => {
      it('uses the migrated application database', () => {
        expect(process.env.CONTRACT_LINE_SAVE_DB_HOST).toBe('127.0.0.2');
        expect(process.env.CONTRACT_LINE_SAVE_DB_PORT).toBe('15432');
        expect(process.env.CONTRACT_LINE_SAVE_DB_USER).toBe('fixture_app');
        expect(process.env.CONTRACT_LINE_SAVE_DB_PASSWORD).toBe('fixture_password');
        expect(process.env.CONTRACT_LINE_SAVE_DB_NAME).toBe('fixture_database');
      });
    });
  `);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init');
  git('add', '.');
  git('-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Runner fixture');

  const result = spawnSync(process.execPath, ['scripts/run-workspace-db-tests.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CI: '1', DB_HOST: '127.0.0.2', DB_PORT: '15432',
      DB_USER_SERVER: 'fixture_app', DB_PASSWORD_SERVER: 'fixture_password', TEST_DB_NAME: 'fixture_database',
      // Stale local opt-ins must never redirect a CI suite outside its database.
      OUTBOUND_DIAG_DB_TESTS: '0', OUTBOUND_DIAG_DB_HOST: 'stale-host',
      OUTBOUND_DIAG_DB_PORT: '5472', OUTBOUND_DIAG_DB_USER: 'stale-user',
      OUTBOUND_DIAG_DB_PASSWORD: 'stale-password', OUTBOUND_DIAG_DB_NAME: 'server',
      CONTRACT_LINE_SAVE_DB_TESTS: '0', CONTRACT_LINE_SAVE_DB_PORT: '6472', CONTRACT_LINE_SAVE_DB_NAME: 'server' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const evidence = JSON.parse(readFileSync(path.join(root, 'test-results/workspace-db/evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.expectedTests.length, 2);
  assert.equal(evidence.counts.passed, 2);
  assert.equal(evidence.counts.skipped + evidence.counts.pending, 0);
});
