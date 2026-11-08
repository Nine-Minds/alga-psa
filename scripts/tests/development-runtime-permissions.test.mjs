// Requires Docker and the development runtime image. Exercises the security
// policy rendered from the same Compose chain as the production browser lane.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DEVELOPMENT_RUNTIME_IMAGE, DEVELOPMENT_RUNTIME_COMPOSE_FILE } from '../lib/development-runtime.mjs';

const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
const files = ['docker-compose.base.yaml', 'docker-compose.ce.yaml', 'docker-compose.prod.yaml',
  'docker-compose.setup-ubuntu.override.yaml', 'docker-compose.imap-test.yaml', 'docker-compose.e2e-emulators.yaml'];

function render(edition, development) {
  const chain = [...files, ...(edition === 'enterprise' ? ['docker-compose.e2e-ee.yaml'] : []),
    ...(development ? [DEVELOPMENT_RUNTIME_COMPOSE_FILE] : [])];
  const env = { ...process.env, E2E_CALLBACK_TLS_DIR: '/unused-tls', E2E_DEVELOPMENT_WORKSPACE: process.cwd(),
    NEXT_PUBLIC_BASE_URL: 'http://localhost:3000' };
  delete env.COMPOSE_FILE;
  const result = execFileSync('docker', ['compose', '--env-file', '/dev/null',
    ...chain.flatMap(file => ['-f', file]), 'config', '--format', 'json'],
  { env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(result).services.server;
}

function runWithPolicy(policy, volume, source) {
  return docker(['run', '--rm', '--network', 'none', '--user', policy.user,
    ...(policy.cap_drop || []).flatMap(cap => ['--cap-drop', cap]),
    ...(policy.cap_add || []).flatMap(cap => ['--cap-add', cap]),
    ...(policy.security_opt || []).flatMap(option => ['--security-opt', option]),
    '-v', `${volume}:/permissions`, '--entrypoint', 'node', DEVELOPMENT_RUNTIME_IMAGE, '-e', source]);
}

for (const edition of ['community', 'enterprise']) {
  test(`${edition}: development can use private shared files while production retains its permission boundaries`, () => {
    const volume = `alga-development-permissions-${randomUUID()}`;
    docker(['volume', 'create', volume]);
    try {
      // Model runtime-permissions' UID 1000 secrets/cache and the hosted runner's
      // UID 1001 checkout. No real checkout or secret is changed by this test.
      docker(['run', '--rm', '--network', 'none', '-v', `${volume}:/permissions`,
        '--entrypoint', 'node', DEVELOPMENT_RUNTIME_IMAGE, '-e', `
          const fs = require('node:fs');
          for (const [name, uid] of [['secrets', 1000], ['cache', 1000], ['checkout', 1001]]) {
            const dir = '/permissions/' + name;
            fs.mkdirSync(dir, { mode: 0o700 });
            fs.writeFileSync(dir + '/file', 'synthetic', { mode: 0o600 });
            fs.chownSync(dir + '/file', uid, uid);
            fs.chownSync(dir, uid, uid);
          }
        `]);
      const production = render(edition, false);
      const development = render(edition, true);
      runWithPolicy(production, volume, `
        const fs = require('node:fs'), assert = require('node:assert/strict');
        assert.equal(process.getuid(), 1000);
        assert.equal(fs.readFileSync('/permissions/secrets/file', 'utf8'), 'synthetic');
        assert.throws(() => fs.readFileSync('/permissions/checkout/file'), { code: 'EACCES' });
        assert.throws(() => fs.chownSync('/permissions/cache/file', 1001, 1001), { code: 'EPERM' });
      `);
      runWithPolicy(development, volume, `
        const fs = require('node:fs'), assert = require('node:assert/strict');
        assert.equal(fs.readFileSync('/permissions/secrets/file', 'utf8'), 'synthetic');
        for (const dir of ['cache', 'checkout']) {
          const probe = '/permissions/' + dir + '/write-probe';
          fs.writeFileSync(probe, 'writable', { flag: 'wx' });
          fs.unlinkSync(probe);
        }
        // File access must not restore unrelated root capabilities.
        assert.throws(() => fs.chownSync('/permissions/cache/file', 1001, 1001), { code: 'EPERM' });
      `);
    } finally {
      docker(['volume', 'rm', volume]);
    }
  });
}
