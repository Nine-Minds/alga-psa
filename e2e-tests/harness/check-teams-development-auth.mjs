import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Run with the image's tsx loader, after start-teams-development-ci.mjs starts
// Next. This checks source modules in a separate Node process, not webpack's
// compiled Next runtime. It never changes users, credentials, or sessions.
export async function checkTeamsDevelopmentAuth({ env, db, getSecret, verifyPassword, readMountedSecret }) {
  if (env.NODE_ENV !== 'development' || env.TEAMS_EMULATOR_MODE !== 'true' || env.E2E_DATABASE_ISOLATED !== 'true') {
    throw new Error('CONFIGURATION');
  }
  if (!env.E2E_USER_EMAIL || !env.E2E_USER_PASSWORD) throw new Error('CREDENTIALS_MISSING');
  // A duplicate email would make the selected source account ambiguous.
  const users = await db('users').where({ email: env.E2E_USER_EMAIL, user_type: 'internal', is_inactive: false })
    .select('hashed_password').limit(2);
  if (users.length !== 1 || !users[0].hashed_password) throw new Error('SOURCE_ACCOUNT_AMBIGUOUS_OR_MISSING');
  const secret = await getSecret('nextauth_secret', 'NEXTAUTH_SECRET');
  if (!secret) throw new Error('AUTH_SECRET_MISSING');
  const mounted = await readMountedSecret();
  const passwordValid = await verifyPassword(env.E2E_USER_PASSWORD, users[0].hashed_password);
  return {
    runtime: 'source-node-preflight',
    status: passwordValid ? 'passed' : 'failed',
    sourcePasswordValid: passwordValid,
    resolvedSecretMatchesMountedFile: mounted === undefined ? null : secret === mounted,
    resolvedSecretMatchesEnvironment: env.NEXTAUTH_SECRET ? secret === env.NEXTAUTH_SECRET : null,
    parameters: {
      iterations: Number(env.ITERATIONS) || 10000,
      keyLength: Number(env.KEY_LENGTH) || 64,
      // The implementation maps unknown algorithm names to SHA-512. Do not
      // print an arbitrary env value that might accidentally contain a secret.
      digest: ['SHA256', 'SHA-256'].includes(String(env.ALGORITHM).toUpperCase()) ? 'SHA-256' : 'SHA-512',
    },
  };
}

async function main() {
  const root = process.env.TEAMS_APP_ROOT || '/app';
  let db;
  const originalConsole = Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(key => [key, console[key]]));
  // Dependencies can log their own errors; keep this diagnostic's output to
  // the explicit allowlisted result below, even on connection failures.
  for (const key of Object.keys(originalConsole)) console[key] = () => {};
  let report;
  try {
    if (process.env.NODE_ENV !== 'development' || process.env.TEAMS_EMULATOR_MODE !== 'true' || process.env.E2E_DATABASE_ISOLATED !== 'true') throw new Error('CONFIGURATION');
    if (!process.env.DB_HOST || !process.env.DB_PORT || !process.env.DB_NAME_SERVER || !process.env.DB_USER_SERVER) throw new Error('DATABASE_CONFIGURATION');
    const require = createRequire(path.join(root, 'package.json'));
    const knex = require('knex');
    const { getSecret } = await import(pathToFileURL(path.join(root, 'packages/core/src/lib/secrets/index.ts')).href);
    const { verifyPassword } = await import(pathToFileURL(path.join(root, 'packages/core/src/lib/encryption.ts')).href);
    const password = await getSecret('db_password_server', 'DB_PASSWORD_SERVER');
    db = knex({ client: 'pg', connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME_SERVER, user: process.env.DB_USER_SERVER, password },
      pool: { min: 0, max: 1 }, acquireConnectionTimeout: 15000 });
    report = await checkTeamsDevelopmentAuth({ env: process.env, db, getSecret, verifyPassword,
      readMountedSecret: async () => {
        try { return (await readFile('/run/secrets/nextauth_secret', 'utf8')).trim(); }
        catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
      },
    });
  } catch (error) {
    const allowed = ['CONFIGURATION', 'CREDENTIALS_MISSING', 'SOURCE_ACCOUNT_AMBIGUOUS_OR_MISSING', 'AUTH_SECRET_MISSING', 'DATABASE_CONFIGURATION'];
    report = { runtime: 'source-node-preflight', status: 'failed',
      reason: allowed.includes(error?.message) ? error.message : 'SOURCE_AUTH_PREFLIGHT_ERROR' };
  } finally {
    if (db) await db.destroy().catch(() => {});
    Object.assign(console, originalConsole);
  }
  console.log(JSON.stringify(report));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
