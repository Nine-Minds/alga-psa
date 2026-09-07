import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('Citus runner records actual Vitest collection and fails before execution when a required suite disappears', t => {
  const source = fileURLToPath(new URL('../../', import.meta.url));
  const root = mkdtempSync(path.join(tmpdir(), 'citus-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); };
  cpSync(path.join(source, 'scripts/lib'), path.join(root, 'scripts/lib'), { recursive: true });
  cpSync(path.join(source, 'scripts/run-citus-runtime-tests.mjs'), path.join(root, 'scripts/run-citus-runtime-tests.mjs'));
  const files = ['ee/temporal-workflows/src/__tests__/integration/workflowInvocationPersistence.integration.test.ts', 'server/src/test/integration/invoiceTicketImmutable.integration.test.ts'];
  for (const file of files) write(file, "test('fixture arithmetic', () => expect(2 + 3).toBe(5));\n");
  write('.gitignore', 'node_modules/\ntest-results/\n');
  const configure = include => write('server/vitest.config.mjs', `export default ${JSON.stringify({ test: { globals: true, include, maxWorkers: 1, fileParallelism: false } })};`);
  configure(files.map(file => path.relative('server', file)));
  symlinkSync(path.join(source, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--no-gpg-sign', '-qm', 'Fixture']);
  const run = (args = []) => spawnSync(process.execPath, ['scripts/run-citus-runtime-tests.mjs', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, TEST_DB_BACKEND: 'citus', CI: '1' },
  });
  const read = name => JSON.parse(readFileSync(path.join(root, `test-results/citus-runtime/${name}.json`), 'utf8'));
  const good = run(); assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(read('discovery').status, 'passed');
  assert.equal(read('evidence').counts.passed, 2);
  assert.equal(read('collected').length, 2);
  configure([path.relative('server', files[0])]);
  const missing = run(); assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.equal(read('collected').length, 1);
  assert.equal(read('discovery').status, 'failed');
  assert.equal(read('results'), null);
  assert.equal(read('evidence').status, 'failed');
  assert.equal(run(['one-file']).status, 1);
  assert.equal(read('collected'), null);
});
