import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as fsSync from 'node:fs';
import path from 'node:path';
import knex, { Knex } from 'knex';

// Load EE and Server env files for local credentials
dotenv.config({ path: path.resolve(process.cwd(), 'ee/server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

const require = createRequire(import.meta.url);

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
      if (fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile()) {
        return fsSync.readFileSync(candidate, 'utf8').trim();
      }
    } catch {
      // ignore and fall back to next candidate / literal value
    }
  }

  return trimmed;
}

class DirectoryMigrationSource {
  private readonly directory: string;
  private readonly filter?: (name: string) => boolean;

  constructor(directory: string, filter?: (name: string) => boolean) {
    this.directory = directory;
    this.filter = filter;
  }

  async getMigrations(loadExtensions?: string[]) {
    const exts = loadExtensions && loadExtensions.length > 0 ? loadExtensions : ['.cjs', '.js'];
    const extensions = new Set(exts.map((e) => (e.startsWith('.') ? e : `.${e}`)));
    const files = await fs.readdir(this.directory).catch(() => [] as string[]);

    const entries = files
      .filter((file) => extensions.has(path.extname(file)))
      .filter((file) => (this.filter ? this.filter(file) : true))
      .map((file) => path.join(this.directory, file))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

    return entries;
  }

  getMigrationName(migration: string) {
    return path.basename(migration);
  }

  getMigration(migration: string) {
    return require(migration);
  }
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

    // Best-effort enable pgvector extension for migrations that use the `vector` type.
    // No-op if the extension isn't available in the backing Postgres image.
    try {
      await db.raw(`CREATE EXTENSION IF NOT EXISTS vector`);
    } catch {
      // ignore
    }

    const serverMigrationsDir = path.resolve(process.cwd(), 'server/migrations');
    const eeMigrationsDir = path.resolve(process.cwd(), 'ee/server/migrations');
    await db.migrate.latest({
      migrationSource: new DirectoryMigrationSource(serverMigrationsDir) as any,
    });

    // 2) Apply only the EE migrations required for extension scheduled tasks.
    // EE migrations directory contains some duplicates of CE migrations and some older AI migrations
    // that are not needed for these tests and can fail after later CE schema changes.
    const eeAllowlist = new Set<string>([
      '2025080801_create_extension_registry.cjs',
      '2025080802_create_extension_version.cjs',
      '2025080803_create_extension_bundle.cjs',
      '2025080804_create_tenant_extension_install.cjs',
      '2025080805_create_extension_event_subscription.cjs',
      '2025080806_create_extension_api_endpoint.cjs',
      '20250810140000_align_registry_v2_schema.cjs',
      '20251031130000_create_install_config_tables.cjs',
      '20260101120000_create_extension_schedule_tables.cjs',
    ]);

    await db.migrate.latest({
      migrationSource: new DirectoryMigrationSource(eeMigrationsDir, (name) => eeAllowlist.has(name)) as any,
      tableName: 'knex_migrations_ee',
    });

    const seedsDirs = [path.resolve(process.cwd(), 'server/seeds/dev')];
    const eeSeedsDir = path.resolve(process.cwd(), 'ee/server/seeds/dev');
    if (fsSync.existsSync(eeSeedsDir)) {
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
