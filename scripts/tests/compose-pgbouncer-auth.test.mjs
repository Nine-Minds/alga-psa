// Regression guard for PgBouncer authentication in the Docker Compose stacks:
//
//   - No pgbouncer*.ini* file in the repository may set `auth_type = trust`.
//   - PgBouncer serves the application role only: its service never mounts the
//     Postgres superuser secret.
//   - Every service that points DB_HOST at PgBouncer and holds the superuser
//     secret must also set DB_HOST_ADMIN, so administration and pg-boss
//     connections go straight to Postgres.
//
// Pure node:test, no npm dependencies. Renders each stack with
// `docker compose config --format json`, which needs neither secrets nor images.
//
// Run: node --test scripts/tests/compose-pgbouncer-auth.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Reading /dev/null as the env file keeps a developer's local .env from
// changing the render (see compose-port-exposure.test.mjs).
const EMPTY_ENV_FILE = '/dev/null';

// Variables that some files require (`:?`). The values are never used.
const DUMMY_ENV = {
  NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
  E2E_CALLBACK_TLS_DIR: '/tmp/compose-pgbouncer-guard-tls',
};

// LEVERAGE: pattern compose-render-helper — same render() as compose-port-exposure.test.mjs
function render(files) {
  const env = { ...process.env, ...DUMMY_ENV };
  delete env.COMPOSE_FILE;
  delete env.COMPOSE_PROFILES;

  const args = ['compose', '-p', 'guard', '--env-file', EMPTY_ENV_FILE, '--profile', '*'];
  for (const file of files) args.push('-f', file);
  args.push('config', '--format', 'json');

  const result = spawnSync('docker', args, {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `docker compose config failed for [${files.join(', ')}]:\n${result.stderr}`
  );
  return JSON.parse(result.stdout);
}

// --- static check on the PgBouncer configuration files -----------------------

const TRUST_AUTH = /^\s*auth_type\s*=\s*trust\b/im;

function pgbouncerIniFiles() {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(listed.status, 0, `git ls-files failed:\n${listed.stderr}`);
  return listed.stdout
    .split('\0')
    .filter((file) => file && /^pgbouncer[^/]*\.ini/.test(path.basename(file)));
}

describe('PgBouncer configuration files', () => {
  test('the detector flags trust and ignores comments and other values', () => {
    assert.ok(TRUST_AUTH.test('[pgbouncer]\nauth_type = trust\n'));
    assert.ok(TRUST_AUTH.test('  AUTH_TYPE=trust'));
    assert.ok(!TRUST_AUTH.test('auth_type = md5\n'));
    assert.ok(!TRUST_AUTH.test('; auth_type = trust\n'));
    assert.ok(!TRUST_AUTH.test('# auth_type = trust\n'));
  });

  test('the shipped template exists and requires a password', () => {
    const files = pgbouncerIniFiles();
    assert.ok(files.includes('pgbouncer/pgbouncer.ini.template'), `found: ${files.join(', ')}`);
    const template = readFileSync(path.join(REPO_ROOT, 'pgbouncer/pgbouncer.ini.template'), 'utf8');
    assert.match(template, /^auth_type\s*=\s*(md5|scram-sha-256)\s*$/m);
  });

  test('no pgbouncer*.ini* file sets auth_type = trust', () => {
    for (const file of pgbouncerIniFiles()) {
      const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.ok(!TRUST_AUTH.test(content), `${file} must not set auth_type = trust`);
    }
  });
});

// --- rendered compose stacks -------------------------------------------------

const STACKS = {
  'dev (root + base + ee)': ['docker-compose.yaml', 'docker-compose.base.yaml', 'docker-compose.ee.yaml'],
  'dev IMAP (root + base + ee + imap.ce + imap-test)': [
    'docker-compose.yaml',
    'docker-compose.base.yaml',
    'docker-compose.ee.yaml',
    'docker-compose.imap.ce.yaml',
    'docker-compose.imap-test.yaml',
  ],
  'base + ce': ['docker-compose.base.yaml', 'docker-compose.ce.yaml'],
  'base + ce + imap.ce + imap-test': [
    'docker-compose.base.yaml',
    'docker-compose.ce.yaml',
    'docker-compose.imap.ce.yaml',
    'docker-compose.imap-test.yaml',
  ],
  'base + ce + prod': ['docker-compose.base.yaml', 'docker-compose.ce.yaml', 'docker-compose.prod.yaml'],
  'prebuilt CE': ['docker-compose.prebuilt.base.yaml', 'docker-compose.prebuilt.ce.yaml'],
  'prebuilt EE': ['docker-compose.prebuilt.base.yaml', 'docker-compose.prebuilt.ee.yaml'],
  'fresh-install CI (CE)': [
    'docker-compose.base.yaml',
    'docker-compose.ce.yaml',
    'docker-compose.prod.yaml',
    'docker-compose.setup-ubuntu.override.yaml',
    'docker-compose.imap-test.yaml',
    'docker-compose.e2e-emulators.yaml',
  ],
  'fresh-install CI (EE)': [
    'docker-compose.base.yaml',
    'docker-compose.ce.yaml',
    'docker-compose.prod.yaml',
    'docker-compose.setup-ubuntu.override.yaml',
    'docker-compose.imap-test.yaml',
    'docker-compose.e2e-emulators.yaml',
    'docker-compose.e2e-ee.yaml',
  ],
};

const POOLER_HOST = /pgbouncer/i;

function mountsSuperuserSecret(service) {
  const secrets = (service.secrets ?? []).map((s) => (typeof s === 'string' ? s : s.source));
  if (secrets.includes('postgres_password')) return true;
  return (service.volumes ?? []).some(
    (v) => typeof v?.source === 'string' && v.source.endsWith('/secrets/postgres_password')
  );
}

const poolerClients = (config) =>
  Object.entries(config.services ?? {}).filter(([, s]) => POOLER_HOST.test(String(s.environment?.DB_HOST ?? '')));

describe('compose stacks keep the superuser off PgBouncer', () => {
  for (const [label, files] of Object.entries(STACKS)) {
    test(label, () => {
      const config = render(files);

      const pooler = config.services?.pgbouncer;
      if (pooler) {
        assert.ok(!mountsSuperuserSecret(pooler), `${label}: pgbouncer must not mount postgres_password`);
      }

      const clients = poolerClients(config);
      for (const [name, service] of clients) {
        if (!mountsSuperuserSecret(service)) continue;
        const adminHost = String(service.environment?.DB_HOST_ADMIN ?? '');
        assert.ok(adminHost, `${label}: ${name} uses PgBouncer and holds postgres_password but has no DB_HOST_ADMIN`);
        assert.ok(
          !POOLER_HOST.test(adminHost),
          `${label}: ${name} DB_HOST_ADMIN must be Postgres, not PgBouncer (${adminHost})`
        );
        assert.ok(
          service.environment?.DB_PORT_ADMIN,
          `${label}: ${name} sets DB_HOST_ADMIN but not DB_PORT_ADMIN`
        );
      }
    });
  }

  test('the stacks exercise at least one PgBouncer client that holds postgres_password', () => {
    const config = render(STACKS['prebuilt CE']);
    const holders = poolerClients(config).filter(([, s]) => mountsSuperuserSecret(s));
    assert.ok(holders.length >= 3, `expected server, workflow-worker and email-service, got ${holders.map(([n]) => n)}`);
  });
});
