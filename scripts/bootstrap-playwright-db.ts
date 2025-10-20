import dotenv from 'dotenv';
import path from 'node:path';
import knex, { Knex } from 'knex';

// Load EE and Server env files for local credentials
dotenv.config({ path: path.resolve(process.cwd(), 'ee/server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

type DbCfg = {
  host: string;
  port: number;
  database: string;
  adminUser: string;
  adminPassword: string;
  appUser: string;
  appPassword: string;
  ssl: boolean;
};

function getCfg(): DbCfg {
  const host = process.env.PLAYWRIGHT_DB_HOST ?? process.env.DB_HOST ?? 'localhost';
  const port = Number(process.env.PLAYWRIGHT_DB_PORT ?? process.env.DB_PORT ?? 5432);
  const database =
    process.env.PLAYWRIGHT_DB_NAME ??
    process.env.DB_NAME_SERVER ??
    'alga_contract_wizard_test';
  const adminUser =
    process.env.PLAYWRIGHT_DB_ADMIN_USER ?? process.env.DB_USER_ADMIN ?? 'postgres';
  const adminPassword =
    process.env.PLAYWRIGHT_DB_ADMIN_PASSWORD ??
    process.env.DB_PASSWORD_ADMIN ??
    process.env.DB_PASSWORD ??
    'postpass123';
  const appUser =
    process.env.PLAYWRIGHT_DB_APP_USER ??
    process.env.DB_USER_SERVER ??
    'app_user';
  const appPassword =
    process.env.PLAYWRIGHT_DB_APP_PASSWORD ??
    process.env.DB_PASSWORD_SERVER ??
    'postpass123';
  const ssl =
    (process.env.PLAYWRIGHT_DB_SSL ?? process.env.DB_SSL ?? '').toLowerCase() === 'true';
  return { host, port, database, adminUser, adminPassword, appUser, appPassword, ssl };
}

async function dropAndRecreateDatabase(cfg: DbCfg): Promise<void> {
  const unsafe = ['server', 'production', 'prod', 'postgres', 'template0', 'template1'];
  const lower = cfg.database.toLowerCase();
  if (unsafe.includes(lower) || lower.length < 4) {
    throw new Error(
      `[Playwright DB] Refusing to drop database '${cfg.database}'. Set PLAYWRIGHT_DB_NAME to a dedicated test DB.`
    );
  }

  const adminConn: Knex.StaticConnectionConfig = {
    host: cfg.host,
    port: cfg.port,
    user: cfg.adminUser,
    password: cfg.adminPassword,
    database: 'postgres',
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
  };

  const adminDb = knex({ client: 'pg', connection: adminConn, pool: { min: 1, max: 2 } });
  try {
    await adminDb.raw('SELECT 1');
    await adminDb.raw(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = ?
         AND pid <> pg_backend_pid()
         AND state <> 'terminated'`,
      [cfg.database]
    );
    const safeDb = cfg.database.replace(/"/g, '""');
    await adminDb.raw(`DROP DATABASE IF EXISTS "${safeDb}"`);
    await adminDb.raw(`CREATE DATABASE "${safeDb}"`);
  } finally {
    await adminDb.destroy().catch(() => undefined);
  }
}

async function migrateAndSeed(cfg: DbCfg): Promise<void> {
  const migrationConn: Knex.StaticConnectionConfig = {
    host: cfg.host,
    port: cfg.port,
    user: cfg.adminUser,
    password: cfg.adminPassword,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
  };
  const db = knex({ client: 'pg', connection: migrationConn, pool: { min: 1, max: 10 } });
  try {
    // Ensure app user exists and has privileges
    const roleCheck = await db.raw('SELECT 1 FROM pg_roles WHERE rolname = ?', [cfg.appUser]);
    const safeRole = cfg.appUser.replace(/"/g, '""');
    const safePass = cfg.appPassword.replace(/'/g, "''");
    if (!roleCheck?.rows?.length) {
      await db.raw(`CREATE ROLE "${safeRole}" LOGIN PASSWORD '${safePass}'`);
    } else {
      await db.raw(`ALTER ROLE "${safeRole}" WITH PASSWORD '${safePass}'`);
    }
    const safeDb = cfg.database.replace(/"/g, '""');
    await db.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDb}" TO "${safeRole}"`);
    await db.raw(`GRANT USAGE, CREATE ON SCHEMA public TO "${safeRole}"`);
    await db.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${safeRole}"`
    );
    await db.raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${safeRole}"`
    );

    const migrationsDir = path.resolve(process.cwd(), 'server/migrations');
    const seedsDir = path.resolve(process.cwd(), 'server/seeds/dev');
    await db.migrate.latest({
      directory: migrationsDir,
      loadExtensions: ['.cjs', '.js'],
    });
    await db.seed
      .run({ directory: seedsDir, loadExtensions: ['.cjs', '.js'] })
      .catch(() => undefined);
  } finally {
    await db.destroy().catch(() => undefined);
  }
}

async function main() {
  const cfg = getCfg();
  // eslint-disable-next-line no-console
  console.log('[Playwright DB] Resetting database:', {
    host: cfg.host,
    port: cfg.port,
    adminUser: cfg.adminUser,
    database: cfg.database,
  });
  await dropAndRecreateDatabase(cfg);
  await migrateAndSeed(cfg);
  // eslint-disable-next-line no-console
  console.log('[Playwright DB] Database prepared.');
}

main().catch((err) => {
  console.error('Failed to bootstrap Playwright database:', err);
  process.exit(1);
});
