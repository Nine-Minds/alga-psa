import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { upgradePgbouncerConfiguration } from '../../e2e-tests/harness/create-upgrade-pgbouncer.mjs';
const template = await readFile(new URL('../../pgbouncer/pgbouncer.ini.template', import.meta.url), 'utf8');
function parseIni(text) { const sections = {}; let section; for (const line of text.split('\n')) {
  if (/^\[/.test(line)) { section = line.slice(1, -1); sections[section] = {}; }
  else if (line.trim() && !/^\s*[;#]/.test(line)) { const at = line.indexOf('='); assert.ok(at > 0); sections[section][line.slice(0, at).trim()] = line.slice(at + 1).trim(); }
} return sections; }
const input = () => ({ name: 'alga-e2e-test', services: { pgbouncer: { image: 'candidate-pooler:test', environment: { DB_USER_SERVER: 'app_user' } },
  server: { environment: { DB_HOST: 'pgbouncer' } }, 'email-service': { environment: { DB_HOST: 'pgbouncer' } } } });
test('isolated mapping preserves actual candidate pooler policy and direct admin access', () => {
  const compose = input(), before = structuredClone(compose);
  const result = upgradePgbouncerConfiguration({ compose, template, templatePath: '/tmp/upgrade/pooler.ini' });
  const parsed = parseIni(result.template), original = parseIni(template);
  assert.deepEqual(parsed.pgbouncer, original.pgbouncer);
  assert.deepEqual(parsed.databases, { upgrade_ci: 'host=${POSTGRES_HOST} port=5432 dbname=upgrade_ci' });
  const service = result.compose.services['upgrade-pgbouncer'];
  assert.equal(service.image, compose.services.pgbouncer.image); assert.equal(service.ports, undefined);
  assert.deepEqual(service.networks, ['app-network']); assert.equal(service.entrypoint, undefined);
  assert.deepEqual(service.secrets, ['postgres_password', 'db_password_server']);
  assert.deepEqual(result.compose.services.server.environment, { DB_HOST: 'upgrade-pgbouncer', DB_PORT: '6432', DB_NAME_SERVER: 'upgrade_ci', DB_HOST_ADMIN: 'postgres', DB_PORT_ADMIN: '5432' });
  assert.deepEqual(Object.keys(result.compose.services).sort(), ['server', 'upgrade-pgbouncer']); assert.deepEqual(compose, before);
});
test('resolves Compose-generated candidate tag and carries the application username', () => {
  const compose = input(); delete compose.services.pgbouncer.image; compose.services.pgbouncer.environment.DB_USER_SERVER = 'upgrade_app';
  const result = upgradePgbouncerConfiguration({ compose, template, templatePath: '/tmp/test.ini' });
  assert.equal(result.compose.services['upgrade-pgbouncer'].image, 'alga-e2e-test-pgbouncer');
  assert.equal(result.compose.services['upgrade-pgbouncer'].environment.DB_USER_SERVER, 'upgrade_app');
});
test('rejects unknown template shape and missing candidate configuration', () => {
  for (const extra of [{ template: '[unknown]\nx=1\n' }, { compose: { name: 'test', services: {} } }, { templatePath: 'relative.ini' }, { compose: { ...input(), name: 'another-project' } }])
    assert.throws(() => upgradePgbouncerConfiguration({ compose: input(), template, templatePath: '/tmp/test.ini', ...extra }));
});
test('CLI writes usable isolated files and refuses to overwrite existing phase state', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'upgrade-pooler-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const composePath = path.join(directory, 'source.json'), output = path.join(directory, 'output');
  await writeFile(composePath, JSON.stringify(input()));
  const args = [path.resolve('e2e-tests/harness/create-upgrade-pgbouncer.mjs'), composePath, output];
  assert.equal(spawnSync(process.execPath, args).status, 0);
  const generated = JSON.parse(await readFile(path.join(output, 'upgrade-compose.json')));
  const mounted = generated.services['upgrade-pgbouncer'].volumes[0];
  assert.deepEqual(parseIni(await readFile(mounted.source, 'utf8')).databases, { upgrade_ci: 'host=${POSTGRES_HOST} port=5432 dbname=upgrade_ci' });
  const original = await readFile(mounted.source, 'utf8');
  const rejected = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(rejected.status, 1); assert.equal(await readFile(mounted.source, 'utf8'), original);
  assert.equal(rejected.stderr.trim(), 'Isolated upgrade pooler configuration failed');
});
