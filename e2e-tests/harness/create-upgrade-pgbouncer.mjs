import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function upgradePgbouncerConfiguration({ compose, template, templatePath }) {
  const source = compose?.services?.pgbouncer;
  assert.ok(source, 'Existing candidate pooler configuration is required');
  assert.equal(compose.name, 'alga-e2e-test', 'Expected isolated CI Compose project');
  const image = source.image ?? `${compose.name}-pgbouncer`;
  assert.ok(typeof image === 'string' && image.trim() === image && image.length > 0 && !/\s/.test(image), 'Candidate pooler image is required');
  assert.ok(typeof templatePath === 'string' && path.isAbsolute(templatePath), 'Absolute template path is required');
  assert.equal(typeof template, 'string');
  const sections = [...template.matchAll(/^\[([^\]]+)\]\s*$/gm)];
  assert.deepEqual(sections.map(match => match[1]), ['databases', 'pgbouncer'], 'Expected pooler template sections');
  const settings = template.slice(sections[1].index);
  // Preserve the candidate template's authentication, transaction pooling and
  // limits verbatim. This overlay changes only the isolated database mapping.
  const ini = `[databases]\nupgrade_ci = host=\${POSTGRES_HOST} port=5432 dbname=upgrade_ci\n\n${settings}`;
  const appUser = source.environment?.DB_USER_SERVER || 'app_user';
  assert.ok(typeof appUser === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appUser), 'Invalid application user');
  return { template: ini, compose: { services: {
    'upgrade-pgbouncer': { image, environment: { POSTGRES_HOST: 'postgres', POSTGRES_USER: 'postgres', DB_USER_SERVER: appUser },
      secrets: ['postgres_password', 'db_password_server'],
      volumes: [{ type: 'bind', source: templatePath, target: '/etc/pgbouncer/pgbouncer.ini.template', read_only: true }],
      networks: ['app-network'], depends_on: { postgres: { condition: 'service_healthy' } } },
    server: { environment: { DB_HOST: 'upgrade-pgbouncer', DB_PORT: '6432', DB_NAME_SERVER: 'upgrade_ci',
      DB_HOST_ADMIN: 'postgres', DB_PORT_ADMIN: '5432' } },
  } } };
}

export async function writeUpgradePgbouncerConfiguration(composePath, outputDirectory) {
  const compose = JSON.parse(await readFile(composePath, 'utf8'));
  const template = await readFile(new URL('../../pgbouncer/pgbouncer.ini.template', import.meta.url), 'utf8');
  const templatePath = path.resolve(outputDirectory, 'upgrade-pgbouncer.ini.template');
  const generated = upgradePgbouncerConfiguration({ compose, template, templatePath });
  // A dedicated fresh directory prevents overwriting another phase's files.
  await mkdir(outputDirectory);
  await writeFile(templatePath, generated.template, { flag: 'wx' });
  await writeFile(path.join(outputDirectory, 'upgrade-compose.json'), `${JSON.stringify(generated.compose, null, 2)}\n`, { flag: 'wx' });
  return generated;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error('Expected compose and output directory');
    await writeUpgradePgbouncerConfiguration(process.argv[2], process.argv[3]);
  } catch { console.error('Isolated upgrade pooler configuration failed'); process.exitCode = 1; }
}
