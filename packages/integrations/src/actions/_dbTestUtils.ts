import { knex, type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getSecret } from '@alga-psa/core/secrets';

// Local DB bootstrap for integrations DB-backed suites. Deliberately does NOT
// import server/test-utils or packages/billing: a package → package import
// edge introduces a new project cycle the circular-deps guard rejects.
// Mirrors the sanctioned pattern in packages/billing/src/actions/_dbTestUtils.ts.

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// packages/integrations/src/actions -> repo root is four levels up.
const repoRoot = path.resolve(__dirname, '../../../..');
const serverRoot = path.join(repoRoot, 'server');

const PRODUCTION_DB_NAMES = ['sebastian_prod', 'production', 'prod', 'server'];
const TEST_DB_NAME = 'test_database';

export function wireLocalTestDbEnv(): void {
  if (process.env.CI) return;
  const secretsDir = path.resolve(repoRoot, 'secrets');
  const readSecret = (name: string) => {
    try {
      return fs.readFileSync(path.join(secretsDir, name), 'utf8').trim();
    } catch {
      return undefined;
    }
  };
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = '5472';
  process.env.DB_USER_ADMIN = 'postgres';
  process.env.DB_USER_SERVER = 'app_user';
  process.env.DB_PASSWORD_ADMIN = readSecret('postgres_password') || 'postpass123';
  process.env.DB_PASSWORD_SERVER = readSecret('db_password_server') || 'postpass123';
  (process.env as Record<string, string>).NODE_ENV = 'test';
}

function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.includes(dbName.toLowerCase())) {
    throw new Error(`Attempting to use production database (${dbName}) for testing`);
  }
}

async function recreateDatabase(
  databaseName: string,
  dbHost: string,
  dbPort: number,
  adminUser: string,
  adminPassword: string,
  appUser: string,
  appPassword: string
): Promise<void> {
  const adminConnection = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: 'postgres',
    },
    pool: { min: 1, max: 2 },
  });

  try {
    const safeDbName = databaseName.replace(/"/g, '""');
    await adminConnection.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [databaseName]
    );
    await adminConnection.raw(`DROP DATABASE IF EXISTS "${safeDbName}"`);
    await adminConnection.raw(`CREATE DATABASE "${safeDbName}"`);
    await adminConnection.raw(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
          CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        ELSE
          ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        END IF;
      END;
    $$;`);
    await adminConnection.raw(`ALTER DATABASE "${safeDbName}" OWNER TO ${appUser}`);
    await adminConnection.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDbName}" TO ${appUser}`);
    if (adminUser !== appUser) {
      await adminConnection.raw(`GRANT ${adminUser} TO ${appUser}`);
    }
  } finally {
    await adminConnection.destroy().catch(() => undefined);
  }
}

export async function createTestDbConnection(): Promise<Knex> {
  const databaseName = TEST_DB_NAME;
  const migrationsDir = path.join(serverRoot, 'migrations');
  const seedsDir = path.join(serverRoot, 'seeds', 'dev');

  verifyTestDatabase(databaseName);

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = await getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'postpass123');

  await recreateDatabase(databaseName, dbHost, dbPort, adminUser, adminPassword, appUser, appPassword);

  process.env.DB_HOST = dbHost;
  process.env.DB_PORT = String(dbPort);
  process.env.DB_NAME_SERVER = databaseName;
  process.env.DB_USER_SERVER = appUser;
  process.env.DB_USER_ADMIN = adminUser;

  const adminKnex = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: databaseName,
    },
    migrations: { directory: migrationsDir },
    seeds: { directory: seedsDir },
  });

  await adminKnex.raw('CREATE TABLE IF NOT EXISTS public.pg_dist_partition (logicalrelid regclass)');

  await adminKnex.migrate.latest();
  await adminKnex.seed.run();

  const safeAppUser = appUser.replace(/[^a-zA-Z0-9_]/g, '');
  await adminKnex.raw(`ALTER ROLE ${safeAppUser} RESET idle_in_transaction_session_timeout`);
  await adminKnex.raw(`ALTER ROLE ${safeAppUser} RESET lock_timeout`);

  await adminKnex.destroy();

  return knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: appUser,
      password: appPassword,
      database: databaseName,
    },
    asyncStackTraces: true,
    pool: { min: 2, max: 20 },
  });
}
