import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import knex, { Knex } from 'knex';

// Load EE and Server env files for local credentials
dotenv.config({ path: path.resolve(process.cwd(), 'ee/server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

function resolveSecretValue(raw?: string): string | undefined {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const candidates: string[] = [trimmed];

  // If running locally, a docker-style secret path often corresponds to ./secrets/<name>
  if (trimmed.startsWith('/run/secrets/')) {
    candidates.push(path.resolve(process.cwd(), 'secrets', path.basename(trimmed)));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return fs.readFileSync(candidate, 'utf8').trim();
      }
    } catch {
      // ignore and fall back to next candidate / literal value
    }
  }

  return trimmed;
}

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
    resolveSecretValue(process.env.PLAYWRIGHT_DB_ADMIN_PASSWORD) ??
    resolveSecretValue(process.env.DB_PASSWORD_ADMIN) ??
    resolveSecretValue(process.env.DB_PASSWORD) ??
    'postpass123';
  const appUser =
    process.env.PLAYWRIGHT_DB_APP_USER ??
    process.env.DB_USER_SERVER ??
    'app_user';
  const appPassword =
    resolveSecretValue(process.env.PLAYWRIGHT_DB_APP_PASSWORD) ??
    resolveSecretValue(process.env.DB_PASSWORD_SERVER) ??
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

    const serverMigrationsDir = path.resolve(process.cwd(), 'server/migrations');
    const eeMigrationsDir = path.resolve(process.cwd(), 'ee/server/migrations');
    let migrationsDir = serverMigrationsDir;

    if (fs.existsSync(eeMigrationsDir)) {
      const combinedDir = path.resolve(process.cwd(), 'server/.tmp-playwright-migrations');
      fs.rmSync(combinedDir, { recursive: true, force: true });
      fs.cpSync(serverMigrationsDir, combinedDir, { recursive: true });

      for (const entry of fs.readdirSync(eeMigrationsDir)) {
        const src = path.join(eeMigrationsDir, entry);
        if (!fs.statSync(src).isFile()) continue;
        const dest = path.join(combinedDir, entry);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
        }
      }
      migrationsDir = combinedDir;
    }

    await db.migrate.latest({
      directory: migrationsDir,
      loadExtensions: ['.cjs', '.js'],
    });

    const seedsDirs = [path.resolve(process.cwd(), 'server/seeds/dev')];
    const eeSeedsDir = path.resolve(process.cwd(), 'ee/server/seeds/dev');
    if (fs.existsSync(eeSeedsDir)) {
      seedsDirs.push(eeSeedsDir);
    }

    for (const dir of seedsDirs) {
      await db.seed.run({ directory: dir, loadExtensions: ['.cjs', '.js'] }).catch(() => undefined);
    }
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
