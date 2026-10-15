import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = fileURLToPath(new URL('../..', import.meta.url));
test('database runner rejects incomplete connections and replaces stale success evidence before launching tests', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-db-runner-'));
  try {
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    cpSync(path.join(source, 'scripts/lib'), path.join(root, 'scripts/lib'), { recursive: true });
    cpSync(path.join(source, 'scripts/run-additional-workspace-tests.mjs'), path.join(root, 'scripts/run-additional-workspace-tests.mjs'));
    const git = args => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    git(['init', '-q']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
    const output = path.join(root, 'test-results/temporal-database');
    mkdirSync(output, { recursive: true });
    const required = { DB_NAME_SERVER: 'isolated', DB_USER_ADMIN: 'test', DB_PASSWORD_ADMIN: 'dummy', DB_HOST: '127.0.0.1', DB_PORT: '1' };
    for (const missing of Object.keys(required)) {
      const env = { ...process.env, ...required };
      for (const key of ['DB_HOST_ADMIN', 'DB_PORT_ADMIN', missing]) delete env[key];
      writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ status: 'passed' }));
      writeFileSync(path.join(output, 'results.json'), JSON.stringify({ success: true }));
      const run = spawnSync(process.execPath, ['scripts/run-additional-workspace-tests.mjs', 'temporal-database'], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
      assert.equal(run.status, 1, `${missing}: ${run.stderr}`);
      const evidence = JSON.parse(readFileSync(path.join(output, 'evidence.json'), 'utf8'));
      assert.equal(evidence.status, 'failed');
      assert.ok(evidence.failures.some(message => message.includes('require an explicit migrated database and admin connection')), JSON.stringify(evidence));
      assert.equal(JSON.parse(readFileSync(path.join(output, 'results.json'), 'utf8')), null);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
