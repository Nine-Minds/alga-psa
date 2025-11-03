import { Knex, knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const PRODUCTION_DB_NAMES = ['sebastian_prod', 'production', 'prod'];
const TEST_DB_NAME = 'sebastian_integration';
const DB_HOST = 'localhost';
const DB_PORT = 5432;
const ADMIN_USER = 'postgres';
const ADMIN_PASSWORD = 'test_password';
const APP_USER = 'app_user';
const APP_PASSWORD = 'postpass123';

export function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.includes(dbName.toLowerCase())) {
    throw new Error(`Attempting to use production database (${dbName}) for testing`);
  }
}

export async function createTestDbConnection(): Promise<Knex> {
  verifyTestDatabase(TEST_DB_NAME);

  await recreateDatabase(TEST_DB_NAME);

  process.env.DB_HOST = DB_HOST;
  process.env.DB_PORT = String(DB_PORT);
  process.env.DB_NAME_SERVER = TEST_DB_NAME;
  process.env.DB_USER_SERVER = APP_USER;
  process.env.DB_PASSWORD_SERVER = APP_PASSWORD;
  process.env.DB_USER_ADMIN = ADMIN_USER;
  process.env.DB_PASSWORD_ADMIN = ADMIN_PASSWORD;

  const adminKnex = knex({
    client: 'pg',
    connection: {
      host: DB_HOST,
      port: DB_PORT,
      user: ADMIN_USER,
      password: ADMIN_PASSWORD,
      database: TEST_DB_NAME,
    },
    migrations: {
      directory: path.join(serverRoot, 'migrations'),
    },
    seeds: {
      directory: path.join(serverRoot, 'seeds', 'dev'),
    },
  });

  await adminKnex.migrate.latest();
  await adminKnex.seed.run();
  await adminKnex.destroy();

  const db = knex({
    client: 'pg',
    connection: {
      host: DB_HOST,
      port: DB_PORT,
      user: APP_USER,
      password: APP_PASSWORD,
      database: TEST_DB_NAME,
    },
    asyncStackTraces: true,
    pool: {
      min: 2,
      max: 20,
    },
  });

  return db;
}

async function recreateDatabase(databaseName: string): Promise<void> {
  const adminConnection = knex({
    client: 'pg',
    connection: {
      host: DB_HOST,
      port: DB_PORT,
      user: ADMIN_USER,
      password: ADMIN_PASSWORD,
      database: 'postgres',
    },
    pool: {
      min: 1,
      max: 2,
    },
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
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_USER}') THEN
          CREATE ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}';
        ELSE
          ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}';
        END IF;
      END;
    $$;`);
    await adminConnection.raw(`ALTER DATABASE "${safeDbName}" OWNER TO ${APP_USER}`);
    await adminConnection.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDbName}" TO ${APP_USER}`);
  } finally {
    await adminConnection.destroy().catch(() => undefined);
  }
}

export async function createTestDbConnectionWithTenant(tenant: string): Promise<Knex> {
  return createTestDbConnection();
}

export function isValidTenantId(tenantId: string): boolean {
  if (!tenantId) return true;
  if (tenantId === 'default') return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId);
}
