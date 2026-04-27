import { knex, type Knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { getSecret } from '@alga-psa/core/secrets';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../..');
const TEST_DB_NAME = 'test_database';
const PRODUCTION_DB_NAMES = new Set(['sebastian_prod', 'production', 'prod', 'server']);

function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.has(dbName.toLowerCase())) {
    throw new Error(`Attempting to use production database (${dbName}) for testing`);
  }
}

function testWorkerSuffix(): string | null {
  const workerId = process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID;
  return workerId ? workerId.replace(/[^a-zA-Z0-9_]/g, '_') : null;
}

function withTestWorkerSuffix(value: string): string {
  const suffix = testWorkerSuffix();
  return suffix ? `${value}_${suffix}`.slice(0, 63) : value;
}

function resolveTestDatabaseName(): string {
  const baseName = process.env.DB_NAME_SERVER || TEST_DB_NAME;
  verifyTestDatabase(baseName);
  return withTestWorkerSuffix(baseName);
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
  } finally {
    await adminConnection.destroy().catch(() => undefined);
  }
}

export async function createTestDbConnection(): Promise<Knex> {
  const databaseName = resolveTestDatabaseName();

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = Number.parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = withTestWorkerSuffix(process.env.DB_USER_SERVER || 'app_user').replace(/[^a-zA-Z0-9_]/g, '_');
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
    migrations: { directory: path.join(repoRoot, 'server', 'migrations') },
    seeds: { directory: path.join(repoRoot, 'server', 'seeds', 'dev') },
  });

  await adminKnex.migrate.latest();
  await adminKnex.seed.run();
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

export async function createTenant(db: Knex, name = 'Test Tenant'): Promise<string> {
  const tenantId = uuidv4();
  const now = new Date().toISOString();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: name,
    phone_number: '555-0100',
    email: `test-${tenantId.substring(0, 8)}@example.com`,
    created_at: now,
    updated_at: now,
    payment_platform_id: `test-platform-${tenantId.substring(0, 8)}`,
    payment_method_id: `test-method-${tenantId.substring(0, 8)}`,
    auth_service_id: `test-auth-${tenantId.substring(0, 8)}`,
    plan: 'pro',
  });

  return tenantId;
}

export async function createUser(
  db: Knex,
  tenantId: string,
  options: {
    email?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    user_type?: 'client' | 'internal';
    is_inactive?: boolean;
    contact_id?: string;
    phone?: string;
    timezone?: string;
  } = {}
): Promise<string> {
  const userId = uuidv4();

  await db('users').insert({
    user_id: userId,
    tenant: tenantId,
    username: options.username || `test.user.${userId}`,
    first_name: options.first_name || 'Test',
    last_name: options.last_name || 'User',
    email: options.email || `test.user.${userId}@example.com`,
    hashed_password: 'hashed_password_here',
    created_at: new Date(),
    two_factor_enabled: false,
    is_google_user: false,
    is_inactive: options.is_inactive ?? false,
    user_type: options.user_type || 'internal',
    contact_id: options.contact_id,
    phone: options.phone,
    timezone: options.timezone,
  });

  return userId;
}
