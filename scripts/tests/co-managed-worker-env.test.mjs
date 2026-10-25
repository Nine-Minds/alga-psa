import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('worker environment retains system invitation mail, literal secrets and the selected review origin', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'co-managed-worker-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/dev', 'server', 'secrets', 'ee/temporal-workflows', 'services/workflow-worker']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  const script = path.join(root, 'scripts/dev/generate-co-managed-worker-env.sh');
  copyFileSync(new URL('../dev/generate-co-managed-worker-env.sh', import.meta.url), script);
  const settings = {
    DB_PASSWORD_SERVER: 'fake&db', DB_PASSWORD_ADMIN: 'fake&admin', REDIS_PASSWORD: 'fake&redis',
    NEXTAUTH_SECRET: 'fake-auth', DB_NAME_SERVER: 'test_db', DB_HOST: '127.0.0.1', DB_PORT: '5376',
    REDIS_HOST: '127.0.0.1', REDIS_PORT: '6374', TEMPORAL_ADDRESS: '127.0.0.1:7374',
    APPLICATION_URL: 'http://dev.localhost:3374', EMAIL_ENABLE: 'true', EMAIL_HOST: '127.0.0.1',
    EMAIL_PORT: '3025', EMAIL_FROM: 'Review <review@example.test>', EMAIL_PASSWORD: 'fake&smtp',
    MICROSOFT_GRAPH_BASE_URL: 'http://127.0.0.1:9176/v1.0',
  };
  writeFileSync(path.join(root, 'server/.env.local'), Object.entries(settings).map(([k,v]) => `${k}=${v}`).join('\n') + '\n');
  for (const name of ['alga_auth_key', 'credential_encryption_key']) writeFileSync(path.join(root, 'secrets', name), 'fake-key');
  for (const override of [undefined, 'http://review.localhost:23374']) {
    const env = { ...process.env };
    delete env.CO_MANAGED_WORKER_APPLICATION_URL;
    if (override) env.CO_MANAGED_WORKER_APPLICATION_URL = override;
    const result = spawnSync('bash', [script], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const worker of ['ee/temporal-workflows', 'services/workflow-worker']) {
      const lines = readFileSync(path.join(root, worker, '.env'), 'utf8').split('\n');
      for (const key of ['EMAIL_ENABLE', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_FROM', 'EMAIL_PASSWORD', 'DB_PASSWORD_SERVER', 'REDIS_PASSWORD', 'MICROSOFT_GRAPH_BASE_URL']) {
        assert.ok(lines.includes(`${key}=${settings[key]}`), `${worker}: ${key}`);
      }
      assert.ok(lines.includes(`APPLICATION_URL=${override ?? settings.APPLICATION_URL}`));
    }
  }
});
