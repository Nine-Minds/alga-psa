import { Knex, knex } from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getSecret } from '../src/lib/utils/getSecret';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const PRODUCTION_DB_NAMES = ['sebastian_prod', 'production', 'prod', 'server'];
const TEST_DB_NAME = 'test_database';

export interface CreateTestDbConnectionOptions {
  databaseName?: string;
  migrationsDir?: string;
  seedsDir?: string;
  runSeeds?: boolean;
  /**
   * When false, skip the destructive bootstrap (drop/recreate + migrate + seed)
   * and just connect to the already-bootstrapped test database. Helpers that
   * run after a TestContext bootstrap must use this or they wipe its data.
   * @default true
   */
  recreate?: boolean;
}

export function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.includes(dbName.toLowerCase())) {
    throw new Error(`Attempting to use production database (${dbName}) for testing`);
  }
}

export async function createTestDbConnection(
  options: CreateTestDbConnectionOptions = {}
): Promise<Knex> {
  const databaseName = options.databaseName || TEST_DB_NAME;
  const migrationsDir = options.migrationsDir || path.join(serverRoot, 'migrations');
  const seedsDir = options.seedsDir || path.join(serverRoot, 'seeds', 'dev');
  const runSeeds = options.runSeeds ?? true;

  verifyTestDatabase(databaseName);

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = await getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'postpass123');
  const recreate = options.recreate ?? true;

  if (!recreate) {
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
      pool: {
        min: 2,
        max: 20,
      },
    });
  }

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
    migrations: {
      directory: migrationsDir,
    },
    seeds: {
      directory: seedsDir,
    },
  });

  // Citus-distribution probes (SELECT ... FROM pg_dist_partition) run inside
  // dozens of migrations; on plain Postgres each one ERRORs server-side before
  // its try/catch concludes "not Citus". An empty stand-in catalog makes every
  // probe succeed with is_distributed=false — same behavior, silent logs.
  await adminKnex.raw('CREATE TABLE IF NOT EXISTS public.pg_dist_partition (logicalrelid regclass)');

  await adminKnex.migrate.latest();
  if (runSeeds) {
    await adminKnex.seed.run();
  }

  // The DB-guardrail migration sets cluster-wide role GUCs
  // (idle_in_transaction_session_timeout, lock_timeout) on the app role.
  // They are production insurance; in tests they turn legitimate lock waits
  // and slow in-transaction work into spurious timeouts. Reset them after
  // every bootstrap (the migration re-sets them each run).
  const safeAppUser = appUser.replace(/[^a-zA-Z0-9_]/g, '');
  await adminKnex.raw(`ALTER ROLE ${safeAppUser} RESET idle_in_transaction_session_timeout`);
  await adminKnex.raw(`ALTER ROLE ${safeAppUser} RESET lock_timeout`);

  await adminKnex.destroy();

  const db = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: appUser,
      password: appPassword,
      database: databaseName,
    },
    asyncStackTraces: true,
    pool: {
      min: 2,
      max: 20,
    },
  });

  return db;
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
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
          CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        ELSE
          ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        END IF;
      END;
    $$;`);
    await adminConnection.raw(`ALTER DATABASE "${safeDbName}" OWNER TO ${appUser}`);
    await adminConnection.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDbName}" TO ${appUser}`);
    // Some migrations and test helpers run CREATE ROLE / ALTER ... OWNER TO postgres
    // as the app user; make the app role a member of the admin role so those
    // succeed (resetDatabase used to do this before initialize was collapsed to a
    // single bootstrap).
    if (adminUser !== appUser) {
      await adminConnection.raw(`GRANT ${adminUser} TO ${appUser}`);
    }
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
