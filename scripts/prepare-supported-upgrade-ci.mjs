import knex from 'knex';
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

if (!process.env.GITHUB_ENV || !process.env.RUNNER_TEMP || !process.env.E2E_USER_EMAIL) throw new Error('CI environment and isolated installation user are required');
const pointer = path.join(process.env.RUNNER_TEMP, 'upgrade-output-path');
const db = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN, database: 'server' } });
let user;
try { user = await db('users').where({ email: process.env.E2E_USER_EMAIL }).first('hashed_password'); } finally { await db.destroy(); }
if (!user?.hashed_password) throw new Error('Missing isolated installation account');
const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/run-supported-upgrade.ts'], {
  stdio: 'inherit', env: { ...process.env, UPGRADE_TEST_PASSWORD_HASH: user.hashed_password, UPGRADE_OUTPUT_POINTER: pointer },
});
if (child.status !== 0) process.exit(child.status ?? 1);
const output = readFileSync(pointer, 'utf8').trim();
const schema = JSON.parse(readFileSync(path.join(output, 'evidence.json'), 'utf8'));
if (schema.status !== 'passed') throw new Error('Upgrade schema did not pass');
appendFileSync(process.env.GITHUB_ENV, `UPGRADE_SCHEMA_EVIDENCE=${output}/evidence.json\nUPGRADE_FIXTURE_PATH=${output}/fixture.json\n`);
