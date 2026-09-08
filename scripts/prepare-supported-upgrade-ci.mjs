import knex from 'knex';
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

if (!process.env.GITHUB_ENV || !process.env.RUNNER_TEMP || !process.env.E2E_USER_EMAIL) throw new Error('CI environment and isolated installation user are required');
const pointer = path.join(process.env.RUNNER_TEMP, 'upgrade-output-path');
const db = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'server' } });
let user;
let appRole;
try {
  user = await db('users').where({ email: process.env.E2E_USER_EMAIL }).first('hashed_password');
  if (process.env.UPGRADE_DB_BACKEND === 'citus') {
    appRole = await db('pg_authid').where({ rolname: 'app_user' }).first('rolpassword');
  }
} finally { await db.destroy(); }
if (!user?.hashed_password) throw new Error('Missing isolated installation account');
if (process.env.UPGRADE_DB_BACKEND === 'citus') {
  if (!process.env.UPGRADE_DB_PORT || !appRole?.rolpassword) throw new Error('Citus destination and source app credential are required');
  const target = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.UPGRADE_DB_PORT),
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'postgres' } });
  try {
    // Fresh CI service only: never overwrite an existing role or print its hash.
    const { rows } = await target.raw('SELECT format(?::text, ?::text, ?::text) AS ddl',
      ['CREATE ROLE %I LOGIN PASSWORD %L', 'app_user', appRole.rolpassword]);
    await target.raw(rows[0].ddl);
  } catch { throw new Error('Cannot provision application role on fresh Citus upgrade service'); }
  finally { await target.destroy(); }
}
const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/run-supported-upgrade.ts'], {
  stdio: 'inherit', env: { ...process.env, DB_PORT: process.env.UPGRADE_DB_PORT || process.env.DB_PORT,
    UPGRADE_TEST_PASSWORD_HASH: user.hashed_password, UPGRADE_OUTPUT_POINTER: pointer },
});
if (child.status !== 0) process.exit(child.status ?? 1);
const output = readFileSync(pointer, 'utf8').trim();
const schema = JSON.parse(readFileSync(path.join(output, 'evidence.json'), 'utf8'));
if (schema.status !== 'passed') throw new Error('Upgrade schema did not pass');
appendFileSync(process.env.GITHUB_ENV, `UPGRADE_SCHEMA_EVIDENCE=${output}/evidence.json\nUPGRADE_FIXTURE_PATH=${output}/fixture.json\n`);
