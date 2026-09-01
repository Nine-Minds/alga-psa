import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';

function readOptionalLocalEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, '../../../../server/.env.local');
  if (!fs.existsSync(envPath)) return {};

  // LEVERAGE: pattern env-local-parser — same hand-rolled .env parser as
  // packages/billing/tests/moneyStoryBackend.test.ts readEnv()
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/\s+#.*$/, '').trim();
  }
  return env;
}

/**
 * Resolve the opt-in local database used by inventory integration tests.
 *
 * Reading server/.env.local is deliberately lazy and optional: that file is a
 * developer convenience and is not present in CI. Process environment values
 * take precedence so the integration tests can still be enabled explicitly.
 */
export function getInventoryTestDatabaseConnection(): Knex.PgConnectionConfig | null {
  // These suites target a developer's seeded dev DB, never a CI database.
  // CI jobs export DB_USER_ADMIN/DB_PASSWORD_ADMIN for other suites, which
  // would otherwise resolve a connection here and un-skip every inventory
  // file against a database that doesn't have the dev schema/seed data.
  if (process.env.CI) return null;
  const env = { ...readOptionalLocalEnv(), ...process.env };
  const user = env.DB_USER_ADMIN;
  const password = env.DB_PASSWORD_ADMIN;
  if (!user || !password) return null;

  return {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    user,
    password,
    database: env.DB_NAME ?? 'server',
  };
}
