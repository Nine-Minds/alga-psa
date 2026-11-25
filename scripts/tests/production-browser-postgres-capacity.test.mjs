import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import pg from 'pg';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = [
  'docker-compose.base.yaml',
  'docker-compose.ce.yaml',
  'docker-compose.prod.yaml',
  'docker-compose.setup-ubuntu.override.yaml',
  'docker-compose.imap-test.yaml',
  'docker-compose.e2e-emulators.yaml',
];

function docker(args) {
  return execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}

for (const edition of ['community', 'enterprise']) {
  test(`${edition} browser database accepts login queries while background sessions are connected`, { timeout: 110_000 }, async t => {
    // Render the actual CI stack without inheriting local configuration or
    // starting application services, touching their volumes, or reading secrets.
    const env = { ...process.env, NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
      E2E_CALLBACK_TLS_DIR: '/tmp/browser-capacity-probe-tls' };
    delete env.COMPOSE_FILE;
    delete env.COMPOSE_PROFILES;
    const composeFiles = edition === 'enterprise' ? [...files, 'docker-compose.e2e-ee.yaml'] : files;
    const config = JSON.parse(execFileSync('docker', [
      'compose', '-p', 'browser-capacity-probe', '--env-file', '/dev/null',
      ...composeFiles.flatMap(file => ['-f', file]), 'config', '--format', 'json',
    ], { cwd: root, env, encoding: 'utf8', timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }));
    const postgres = config.services.postgres;
    const name = `browser-capacity-${randomUUID()}`;
    const password = randomUUID();
    // Use the rendered image and startup command on fresh, memory-backed data.
    // The stock image entrypoint initializes it; the deployment wrapper and
    // mounted secrets are irrelevant to the connection-capacity regression.
    docker(['run', '--detach', '--name', name, '--tmpfs', '/var/lib/postgresql/data',
      '--publish', '127.0.0.1::5432', '--env', `POSTGRES_PASSWORD=${password}`,
      postgres.image, ...postgres.command]);
    t.after(() => docker(['rm', '--force', '--volumes', name]));
    const port = Number(docker(['port', name, '5432/tcp']).trim().split(':').at(-1));
    const connection = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password,
      connectionTimeoutMillis: 3000 };
    const deadline = Date.now() + 30_000;
    for (;;) {
      const probe = new pg.Client(connection);
      try {
        await probe.connect();
        await probe.query('SELECT 1');
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await delay(100);
      } finally { await probe.end(); }
    }

    // PgBouncer backends, Temporal, pg-boss, worker/admin pools and fixture
    // connections share this database. Keep more than the stock 100 slots
    // occupied, then establish a separate connection as a login request does.
    const background = Array.from({ length: 110 }, () => new pg.Client(connection));
    const login = new pg.Client(connection);
    try {
      const opened = await Promise.allSettled(background.map(client => client.connect()));
      const failures = opened.filter(result => result.status === 'rejected');
      assert.deepEqual(failures.map(result => ({ code: result.reason.code, message: result.reason.message })), [],
        'Background services must not exhaust the browser database connection budget');
      await login.connect();
      assert.equal((await login.query('SELECT 42 AS answer')).rows[0].answer, 42);
    } finally {
      await Promise.allSettled([...background, login].map(client => client.end()));
    }
  });
}
