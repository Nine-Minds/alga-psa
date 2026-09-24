import { Knex, knex } from 'knex';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getSecret } from '../src/lib/utils/getSecret';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

const PRODUCTION_DB_NAMES = ['sebastian_prod', 'production', 'prod', 'server'];

/**
 * Resolve a database password that may have arrived as a *path* rather than a
 * value. `.env.localtest` (written by alga-local-wirein) sets
 * `DB_PASSWORD_ADMIN=/run/secrets/postgres_password`, and every suite that
 * vi.mocks the secrets provider makes `getSecret()` fall through to that env
 * var. Passing the path string as a password fails with `28P01 password
 * authentication failed for user "postgres"` and every test drops to skipped,
 * which reads like a green run. When the resolved value looks like a file path,
 * read it — first in place, then from the checkout's `secrets/` directory
 * (the host path `.env.localtest` names does not exist outside the container).
 */
async function resolveDbSecret(
  secretName: string,
  envVar: string,
  fallback: string,
): Promise<string> {
  const resolved = await getSecret(secretName, envVar, fallback);
  if (!resolved) return fallback;
  const looksLikePath = resolved.startsWith('/') || resolved.endsWith('.txt');
  if (!looksLikePath) return resolved;
  const candidates = [
    resolved,
    path.resolve(serverRoot, '..', 'secrets', path.basename(resolved)),
    path.resolve(serverRoot, 'secrets', path.basename(resolved)),
  ];
  for (const candidate of candidates) {
    try {
      const value = fs.readFileSync(candidate, 'utf8').trim();
      if (value) return value;
    } catch {
      // Try the next candidate; fall through to the literal value.
    }
  }
  return resolved;
}

/**
 * The suite database, overridable per checkout via `TEST_DB_NAME`.
 *
 * Several worktrees of this repo share one PostgreSQL instance, and every suite
 * that uses `TestContext` drops and recreates this database on startup. Two worktrees running at once therefore migrate the same database to
 * two different schemas and tear each other's connections down mid-test — which
 * surfaces as `Connection terminated unexpectedly`, `terminating connection due
 * to administrator command`, or constraint errors from a schema the branch under
 * test never wrote. Those look like product defects and are not.
 *
 * Setting `TEST_DB_NAME` per worktree gives each one its own database and makes
 * the interference impossible. The default is unchanged, so CI and any single
 * checkout behave exactly as before.
 */
const TEST_DB_NAME = process.env.TEST_DB_NAME || 'test_database';

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
  /** Explicitly permits a non-recreating connection to a protected DB for isolated fixtures. */
  allowProtectedDatabaseForTest?: boolean;
}

// For suites that vi.mock the secrets provider: .env.localtest points
// DB_PASSWORD_* at container secret paths that don't exist on the host, and
// with getAppSecret mocked to undefined, getSecret() falls back to these env
// vars — so rewire them to the local test Postgres + real ./secrets files.
// Local-only: CI already sets correct DB_* step env, and the suite runs
// singleFork, so overriding there would poison every file that runs later.
export function wireLocalTestDbEnv(): void {
  if (process.env.CI) return;
  const secretsDir = path.resolve(serverRoot, '..', 'secrets');
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

export function verifyTestDatabase(dbName: string): void {
  if (PRODUCTION_DB_NAMES.includes(dbName.toLowerCase())) {
    throw new Error(`Attempting to use production database (${dbName}) for testing`);
  }
}

export async function createTestDbConnection(
  options: CreateTestDbConnectionOptions = {}
): Promise<Knex> {
  const databaseName = options.databaseName || TEST_DB_NAME;
  // The EE integration runner supplies a disposable CE+EE overlay. Every
  // per-file recreate must use it, not revert the database to CE-only schema.
  const migrationsDir = options.migrationsDir || process.env.TEST_MIGRATIONS_DIR || path.join(serverRoot, 'migrations');
  const seedsDir = options.seedsDir || path.join(serverRoot, 'seeds', 'dev');
  const runSeeds = options.runSeeds ?? true;

  const isolatedProtectedDbConnection = options.allowProtectedDatabaseForTest === true
    && options.recreate === false
    && databaseName === 'server'
    && process.env.NODE_ENV === 'test';
  if (!isolatedProtectedDbConnection) {
    verifyTestDatabase(databaseName);
  }

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await resolveDbSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = await resolveDbSecret('db_password_server', 'DB_PASSWORD_SERVER', 'postpass123');
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

  const template = await resolveSchemaTemplate({
    dbHost, dbPort, adminUser, adminPassword, appUser, appPassword, migrationsDir, seedsDir, runSeeds,
  });

  const cloned = template
    ? await recreateDatabase(databaseName, dbHost, dbPort, adminUser, adminPassword, appUser, appPassword, template)
    : false;
  if (!cloned) {
    await recreateDatabase(databaseName, dbHost, dbPort, adminUser, adminPassword, appUser, appPassword);
  }

  // Point the app's connection layers (tenant/admin pools read DB_* env at
  // call time) at the suite database — but only for the standard one. Scratch
  // databases (custom databaseName) are used via the returned handle only;
  // the suite runs singleFork, so mutating global env for them would leak the
  // scratch name into later files and send their queries to the wrong DB.
  if (databaseName === TEST_DB_NAME) {
    process.env.DB_HOST = dbHost;
    process.env.DB_PORT = String(dbPort);
    process.env.DB_NAME_SERVER = databaseName;
    process.env.DB_USER_SERVER = appUser;
    process.env.DB_USER_ADMIN = adminUser;
  }

  const adminKnex = adminConnection(databaseName, dbHost, dbPort, adminUser, adminPassword, migrationsDir, seedsDir);
  if (!cloned) {
    await bootstrapSchema(adminKnex, databaseName, runSeeds);
  }
  await resetAppRoleGucs(adminKnex, appUser);
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

function adminConnection(
  databaseName: string,
  dbHost: string,
  dbPort: number,
  adminUser: string,
  adminPassword: string,
  migrationsDir: string,
  seedsDir: string,
): Knex {
  return knex({
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
}

/** Migrate (and seed) an empty database. Runs once per template, or per file without one. */
async function bootstrapSchema(adminKnex: Knex, databaseName: string, runSeeds: boolean): Promise<void> {
  // Citus-distribution probes (SELECT ... FROM pg_dist_partition) run inside
  // dozens of migrations; on plain Postgres each one ERRORs server-side before
  // its try/catch concludes "not Citus". An empty stand-in catalog makes every
  // probe succeed with is_distributed=false — same behavior, silent logs.
  if (process.env.TEST_DB_BACKEND === 'citus') {
    await adminKnex.raw('CREATE EXTENSION IF NOT EXISTS citus');
    await adminKnex.raw('ALTER DATABASE ?? SET citus.shard_count = 4', [databaseName]);
    await adminKnex.raw('SET citus.shard_count = 4');
  } else {
    await adminKnex.raw('CREATE TABLE IF NOT EXISTS public.pg_dist_partition (logicalrelid regclass)');
  }

  await adminKnex.migrate.latest();
  if (runSeeds) {
    await adminKnex.seed.run();
  }
}

/**
 * The DB-guardrail migration sets cluster-wide role GUCs
 * (idle_in_transaction_session_timeout, lock_timeout) on the app role.
 * They are production insurance; in tests they turn legitimate lock waits
 * and slow in-transaction work into spurious timeouts. Reset them after
 * every bootstrap (the migration re-sets them each time it runs).
 */
async function resetAppRoleGucs(adminKnex: Knex, appUser: string): Promise<void> {
  const safeAppUser = appUser.replace(/[^a-zA-Z0-9_]/g, '');
  await adminKnex.raw(`ALTER ROLE ${safeAppUser} RESET idle_in_transaction_session_timeout`);
  await adminKnex.raw(`ALTER ROLE ${safeAppUser} RESET lock_timeout`);
}

// ---------------------------------------------------------------------------
// Schema templates
//
// Every suite file recreates its database, which used to mean replaying ~1000
// migrations plus the dev seeds per file (~15s healthy, >60s on a starved CI
// runner — enough to blow beforeAll timeouts). Instead, the migrated+seeded
// schema is built once per Postgres instance into a template database named
// after a content hash of the migration and seed sources, and each file gets
// `CREATE DATABASE ... TEMPLATE <that>`: a file-level copy that takes about a
// second and yields the identical schema, seed rows and knex_migrations log.
//
// Not used for Citus (distribution metadata does not survive a template copy)
// and can be disabled with TEST_DB_TEMPLATE_CLONE=0. Any failure while building
// or cloning falls back to the per-file rebuild, so it can only be slower, not
// wrong. Note seeds are copied as built: a seed that inserts now() carries the
// template's build time, which is minutes old in CI and refreshed locally when
// any migration or seed changes.
// ---------------------------------------------------------------------------

const TEMPLATE_PREFIX = 'test_schema_tpl_';
const readyTemplates = new Map<string, string | null>();

interface TemplateParams {
  dbHost: string;
  dbPort: number;
  adminUser: string;
  adminPassword: string;
  appUser: string;
  appPassword: string;
  migrationsDir: string;
  seedsDir: string;
  runSeeds: boolean;
}

function templateCloningEnabled(): boolean {
  return process.env.TEST_DB_TEMPLATE_CLONE !== '0' && process.env.TEST_DB_BACKEND !== 'citus';
}

function hashDirectory(hash: ReturnType<typeof createHash>, dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    hash.update(`missing:${dir}`);
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hash.update(`dir:${entry.name}/`);
      hashDirectory(hash, full);
    } else if (entry.isFile()) {
      hash.update(`file:${entry.name}:`);
      hash.update(fs.readFileSync(full));
    }
  }
}

/** Template name for this exact schema source set; sources are hashed by content. */
export function schemaTemplateName(migrationsDir: string, seedsDir: string, runSeeds: boolean): string {
  const hash = createHash('sha1');
  hash.update(`seeds:${runSeeds ? 1 : 0};`);
  hashDirectory(hash, migrationsDir);
  if (runSeeds) hashDirectory(hash, seedsDir);
  return `${TEMPLATE_PREFIX}${hash.digest('hex').slice(0, 16)}`;
}

/** Returns a ready template name, building it on first use, or null when templates are unavailable. */
async function resolveSchemaTemplate(params: TemplateParams): Promise<string | null> {
  if (!templateCloningEnabled()) return null;
  const name = schemaTemplateName(params.migrationsDir, params.seedsDir, params.runSeeds);
  if (readyTemplates.has(name)) return readyTemplates.get(name) ?? null;

  const admin = knex({
    client: 'pg',
    connection: {
      host: params.dbHost,
      port: params.dbPort,
      user: params.adminUser,
      password: params.adminPassword,
      database: 'postgres',
    },
    pool: { min: 1, max: 2 },
  });
  // Two processes (worktrees, parallel runners) may build the same template
  // concurrently; each builds under a private name and renames at the end,
  // so a template that exists under its final name is always complete.
  const building = `${name}_building_${process.pid}`;
  try {
    if (!(await databaseExists(admin, name))) {
      await ensureAppRole(admin, params.appUser, params.appPassword);
      await admin.raw(`DROP DATABASE IF EXISTS "${building}"`);
      await admin.raw(`CREATE DATABASE "${building}"`);
      const builder = adminConnection(building, params.dbHost, params.dbPort, params.adminUser, params.adminPassword, params.migrationsDir, params.seedsDir);
      try {
        await bootstrapSchema(builder, building, params.runSeeds);
      } finally {
        await builder.destroy();
      }
      try {
        await admin.raw(`ALTER DATABASE "${building}" RENAME TO "${name}"`);
      } catch (error) {
        // Lost the race: another process finished first. Use theirs.
        if (!(await databaseExists(admin, name))) throw error;
        await admin.raw(`DROP DATABASE IF EXISTS "${building}"`);
      }
      console.log(`[test-db] built schema template ${name}`);
    }
    readyTemplates.set(name, name);
    return name;
  } catch (error) {
    console.warn(`[test-db] schema template unavailable, falling back to per-file migrate+seed: ${error instanceof Error ? error.message : String(error)}`);
    await admin.raw(`DROP DATABASE IF EXISTS "${building}"`).catch(() => undefined);
    readyTemplates.set(name, null);
    return null;
  } finally {
    await admin.destroy().catch(() => undefined);
  }
}

/** The first migration GRANTs to the app role, so it must exist before any migrate. */
async function ensureAppRole(admin: Knex, appUser: string, appPassword: string): Promise<void> {
  await admin.raw(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
        CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
      ELSE
        ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
      END IF;
    END;
  $$;`);
}

async function databaseExists(admin: Knex, name: string): Promise<boolean> {
  const result = await admin.raw('SELECT 1 FROM pg_database WHERE datname = ?', [name]);
  return result.rows.length > 0;
}

/**
 * Drop and recreate a suite database, from `template` when given. Returns
 * false (and leaves no database behind) when the template copy fails —
 * typically because another session still holds the template open — so the
 * caller can rebuild from migrations instead.
 */
async function recreateDatabase(
  databaseName: string,
  dbHost: string,
  dbPort: number,
  adminUser: string,
  adminPassword: string,
  appUser: string,
  appPassword: string,
  template?: string,
): Promise<boolean> {
  const admin = knex({
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
    await admin.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [databaseName]
    );
    await admin.raw(`DROP DATABASE IF EXISTS "${safeDbName}"`);
    if (template) {
      try {
        await admin.raw(`CREATE DATABASE "${safeDbName}" TEMPLATE "${template}"`);
      } catch (error) {
        console.warn(`[test-db] template clone of ${template} failed, rebuilding from migrations: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    } else {
      await admin.raw(`CREATE DATABASE "${safeDbName}"`);
    }
    await ensureAppRole(admin, appUser, appPassword);
    await admin.raw(`ALTER DATABASE "${safeDbName}" OWNER TO ${appUser}`);
    await admin.raw(`GRANT ALL PRIVILEGES ON DATABASE "${safeDbName}" TO ${appUser}`);
    // Some migrations and test helpers run CREATE ROLE / ALTER ... OWNER TO postgres
    // as the app user; make the app role a member of the admin role so those
    // succeed (resetDatabase used to do this before initialize was collapsed to a
    // single bootstrap).
    if (adminUser !== appUser) {
      await admin.raw(`GRANT ${adminUser} TO ${appUser}`);
    }
    return true;
  } finally {
    await admin.destroy().catch(() => undefined);
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
