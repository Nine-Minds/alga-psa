import dotenv from 'dotenv';
import path from 'path';
import { knex, Knex } from 'knex';

// Load EE server env first
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Also load main server/.env for DB creds if present
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

type RawConfig = {
  host: string;
  port: number;
  database: string;
  adminUser: string;
  adminPassword: string;
  appUser: string;
  appPassword: string;
  ssl: boolean;
};

const secretsDbPassword = (
  process.env.PLAYWRIGHT_DB_APP_PASSWORD ??
  'postpass123'
);

const secretsAdminPassword = (
  process.env.PLAYWRIGHT_DB_ADMIN_PASSWORD ??
  process.env.DB_PASSWORD_ADMIN ??
  process.env.DB_PASSWORD ??
  'postpass123'
);

const DEFAULT_CONFIG: RawConfig = {
  host: process.env.PLAYWRIGHT_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.PLAYWRIGHT_DB_PORT ?? process.env.DB_PORT ?? 5432),
  // Always use a dedicated Playwright test database unless explicitly overridden
  database: process.env.PLAYWRIGHT_DB_NAME ?? 'alga_contract_wizard_test',
  adminUser: process.env.PLAYWRIGHT_DB_ADMIN_USER ?? process.env.DB_USER_ADMIN ?? 'postgres',
  adminPassword: secretsAdminPassword,
  // Keep app user independent of DB_USER_SERVER to avoid accidental override
  appUser: process.env.PLAYWRIGHT_DB_APP_USER ?? 'app_user',
  appPassword: secretsDbPassword,
  ssl: (process.env.PLAYWRIGHT_DB_SSL ?? process.env.DB_SSL ?? '').toLowerCase() === 'true',
};

export const PLAYWRIGHT_DB_CONFIG = DEFAULT_CONFIG;

const truthy = (value: boolean) => (value ? 'true' : 'false');

export function applyPlaywrightDatabaseEnv(): void {
  process.env.DB_TYPE = process.env.DB_TYPE && process.env.DB_TYPE.trim().length > 0 ? process.env.DB_TYPE : 'postgres';
  process.env.DB_TYPE_SERVER = process.env.DB_TYPE_SERVER && process.env.DB_TYPE_SERVER.trim().length > 0 ? process.env.DB_TYPE_SERVER : 'postgres';
  process.env.DB_HOST = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_PORT = String(PLAYWRIGHT_DB_CONFIG.port);
  process.env.DB_NAME = PLAYWRIGHT_DB_CONFIG.database;
  process.env.DB_NAME_SERVER = PLAYWRIGHT_DB_CONFIG.database;
  process.env.DB_SSL = truthy(PLAYWRIGHT_DB_CONFIG.ssl);

  // For local Playwright runs, prefer using admin credentials for app connectivity
  // to avoid issues when the app user is not yet provisioned.
  process.env.DB_USER = PLAYWRIGHT_DB_CONFIG.adminUser;
  process.env.DB_PASSWORD = PLAYWRIGHT_DB_CONFIG.adminPassword;
  process.env.DB_USER_SERVER = PLAYWRIGHT_DB_CONFIG.adminUser;
  process.env.DB_PASSWORD_SERVER = PLAYWRIGHT_DB_CONFIG.adminPassword;
  process.env.DB_USER_HOCUSPOCUS = PLAYWRIGHT_DB_CONFIG.adminUser;
  process.env.DB_PASSWORD_HOCUSPOCUS = PLAYWRIGHT_DB_CONFIG.adminPassword;

  // Admin creds
  process.env.DB_USER_ADMIN = PLAYWRIGHT_DB_CONFIG.adminUser;
  process.env.DB_PASSWORD_ADMIN = PLAYWRIGHT_DB_CONFIG.adminPassword;
  process.env.DB_PASSWORD_SUPERUSER = process.env.DB_PASSWORD_SUPERUSER ?? PLAYWRIGHT_DB_CONFIG.adminPassword;
  process.env.DB_USER_READONLY = process.env.DB_USER_READONLY ?? PLAYWRIGHT_DB_CONFIG.appUser;
  process.env.DB_PASSWORD_READONLY = process.env.DB_PASSWORD_READONLY ?? PLAYWRIGHT_DB_CONFIG.appPassword;

  process.env.DB_DIRECT_HOST = PLAYWRIGHT_DB_CONFIG.host;
  process.env.DB_DIRECT_PORT = String(PLAYWRIGHT_DB_CONFIG.port);

  process.env.TEST_DATABASE_URL = `postgresql://${PLAYWRIGHT_DB_CONFIG.adminUser}:${PLAYWRIGHT_DB_CONFIG.adminPassword}@${PLAYWRIGHT_DB_CONFIG.host}:${PLAYWRIGHT_DB_CONFIG.port}/${PLAYWRIGHT_DB_CONFIG.database}`;
}

export async function ensurePlaywrightDatabase(): Promise<void> {
  const adminUser = process.env.DB_USER_ADMIN ?? PLAYWRIGHT_DB_CONFIG.adminUser;
  const adminPassword = process.env.DB_PASSWORD_ADMIN ?? PLAYWRIGHT_DB_CONFIG.adminPassword;
  const databaseName = PLAYWRIGHT_DB_CONFIG.database;

  const adminConnection = {
    host: PLAYWRIGHT_DB_CONFIG.host,
    port: PLAYWRIGHT_DB_CONFIG.port,
    user: adminUser,
    password: adminPassword,
    database: 'postgres',
  } satisfies Knex.StaticConnectionConfig;

  // Debug info for connectivity
  // eslint-disable-next-line no-console
  console.log('[Playwright DB] Admin connect params', {
    host: PLAYWRIGHT_DB_CONFIG.host,
    port: PLAYWRIGHT_DB_CONFIG.port,
    adminUser,
    databaseName,
  });

  // Safety guard to avoid dropping unintended databases
  const unsafeNames = ['server', 'production', 'prod', 'postgres', 'template1', 'template0'];
  const dbLower = String(databaseName || '').toLowerCase();
  if (unsafeNames.includes(dbLower) || dbLower.length < 4) {
    throw new Error(`[Playwright DB] Refusing to drop database '${databaseName}'. Set PLAYWRIGHT_DB_NAME to a dedicated test DB (e.g., alga_contract_wizard_test).`);
  }

  // Drop and recreate the test database fresh
  {
    const adminDb = knex({ client: 'pg', connection: adminConnection, pool: { min: 1, max: 2 } });
    try {
      await adminDb.raw('SELECT 1');
      await adminDb.raw(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = ?
           AND pid <> pg_backend_pid()
           AND state <> 'terminated'`,
        [databaseName]
      );
      const safeDbName = databaseName.replace(/"/g, '""');
      await adminDb.raw(`DROP DATABASE IF EXISTS "${safeDbName}"`);
      await adminDb.raw(`CREATE DATABASE "${safeDbName}"`);
    } finally {
      await adminDb.destroy().catch(() => undefined);
    }
  }

  const migrationConnection = {
    host: PLAYWRIGHT_DB_CONFIG.host,
    port: PLAYWRIGHT_DB_CONFIG.port,
    user: adminUser,
    password: adminPassword,
    database: databaseName,
  } satisfies Knex.StaticConnectionConfig;

  // Run migrations using admin
  const migrationDb = knex({ client: 'pg', connection: migrationConnection, pool: { min: 1, max: 10 } });

  try {
    // Ensure application user exists with correct password and privileges
    const appUser = PLAYWRIGHT_DB_CONFIG.appUser;
    const appPassword = PLAYWRIGHT_DB_CONFIG.appPassword;

    const roleCheck = await migrationDb.raw('SELECT 1 FROM pg_roles WHERE rolname = ?', [appUser]);
    const safeRole = appUser.replace(/"/g, '""');
    const safePass = appPassword.replace(/'/g, "''");
    if (!roleCheck?.rows?.length) {
      await migrationDb.raw(`CREATE ROLE "${safeRole}" LOGIN PASSWORD '${safePass}'`);
    } else {
      // Ensure password is in sync for repeatable local runs
      await migrationDb.raw(`ALTER ROLE "${safeRole}" WITH PASSWORD '${safePass}'`);
    }

    // Grant privileges on database and public schema
    await migrationDb.raw(`GRANT ALL PRIVILEGES ON DATABASE "${databaseName.replace(/"/g, '""')}" TO "${appUser.replace(/"/g, '""')}"`);
    await migrationDb.raw(`GRANT USAGE, CREATE ON SCHEMA public TO "${appUser.replace(/"/g, '""')}"`);
    await migrationDb.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appUser.replace(/"/g, '""')}"`);
    await migrationDb.raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${appUser.replace(/"/g, '""')}"`);

    const migrationsDir = path.resolve(process.cwd(), 'server/migrations');
    const seedsDir = path.resolve(process.cwd(), 'server/seeds/dev');

    await migrationDb.migrate.latest({
      directory: migrationsDir,
      loadExtensions: ['.cjs', '.js'],
    });

    await migrationDb.seed.run({
      directory: seedsDir,
      loadExtensions: ['.cjs', '.js'],
    }).catch(() => undefined);
  } finally {
    await migrationDb.destroy().catch(() => undefined);
  }

}
