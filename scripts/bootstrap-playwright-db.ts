import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
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

async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

async function copyDir(src: string, dest: string): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await ensureDir(dest);
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
    }
  }
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

    // Install required extensions in the new database
    const newDbConn = knex({
      client: 'pg',
      connection: {
        host: cfg.host,
        port: cfg.port,
        user: cfg.adminUser,
        password: cfg.adminPassword,
        database: safeDb,
      },
    });

    try {
      // Install pgvector extension if available (may not be available in all environments)
      await newDbConn.raw('CREATE EXTENSION IF NOT EXISTS vector').catch(() => {
        console.log('[Playwright DB] pgvector extension not available, skipping');
      });
    } finally {
      await newDbConn.destroy().catch(() => undefined);
    }
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

  // Determine which migrations to use based on NEXT_PUBLIC_EDITION or EDITION env var
  const isEE = process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  let migrationsDir: string;
  let tmpBase: string | undefined;

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

    if (isEE) {
      // Merge CE + EE migrations like run-ee-migrations.js does
      console.log('[Playwright DB] Running in EE mode - merging CE and EE migrations');
      // Find repo root by looking for package.json with workspaces
      let repoRoot = process.cwd();
      while (repoRoot !== '/' && !fs.existsSync(path.join(repoRoot, 'package.json'))) {
        repoRoot = path.dirname(repoRoot);
      }
      // If we found a package.json, check if it has workspaces (indicating repo root)
      if (repoRoot !== '/') {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
          if (!pkg.workspaces) {
            // Go up one more level if this isn't the workspace root
            repoRoot = path.dirname(repoRoot);
          }
        } catch {
          // Ignore errors reading package.json
        }
      }
      const ceDir = path.resolve(repoRoot, 'server', 'migrations');
      const eeDir = path.resolve(repoRoot, 'ee', 'server', 'migrations');

      const ceExists = fs.existsSync(ceDir);
      const eeExists = fs.existsSync(eeDir);

      if (!ceExists && !eeExists) {
        throw new Error('No migrations found: neither server/migrations nor ee/server/migrations exist.');
      }

      // Create temp workspace under OS tmp - mimic server/ structure for migrations
      // Migrations use paths like __dirname/../../scripts, so we need scripts at parent level
      tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'playwright-ee-migrations-'));
      // Create a 'server' subdirectory to match the repo structure
      const serverDir = path.join(tmpBase, 'server');
      await ensureDir(serverDir);
      migrationsDir = path.join(serverDir, 'migrations');
      await ensureDir(migrationsDir);

      // Create a package.json in server dir to enable module resolution
      // This allows migrations that use require('knex') for type annotations to work
      const migrationPackageJson = {
        name: 'playwright-migrations-temp',
        version: '1.0.0',
        private: true,
        dependencies: {
          knex: path.resolve(repoRoot, 'node_modules', 'knex')
        }
      };
      await fsp.writeFile(
        path.join(serverDir, 'package.json'),
        JSON.stringify(migrationPackageJson, null, 2)
      );

      // Create node_modules symlink to workspace node_modules (at server level)
      const nodeModulesLink = path.join(serverDir, 'node_modules');
      const workspaceNodeModules = path.resolve(repoRoot, 'node_modules');
      await fsp.symlink(workspaceNodeModules, nodeModulesLink, 'dir').catch(() => {
        // Symlink might fail on some systems, that's ok - the package.json helps too
      });

      // Create symlink to src directory for migrations that need source files (server/src)
      // Always use CE src since that's where shared source files (like invoice templates) live
      const srcLink = path.join(serverDir, 'src');
      const workspaceSrc = path.resolve(repoRoot, 'server/src');

      if (fs.existsSync(workspaceSrc)) {
        console.log(`[Playwright DB] Creating symlink from ${srcLink} to ${workspaceSrc}`);
        await fsp.symlink(workspaceSrc, srcLink, 'dir').catch((err) => {
          console.log('[Playwright DB] Could not symlink src directory:', err.message);
        });
        // Verify symlink was created
        if (fs.existsSync(srcLink)) {
          console.log(`[Playwright DB] src symlink created successfully`);
        } else {
          console.log(`[Playwright DB] Warning: src symlink was not created`);
        }
      } else {
        console.log(`[Playwright DB] Warning: src directory not found at ${workspaceSrc}`);
      }

      // Create symlink to scripts directory (at repo root level, parent of server/)
      // Migrations use __dirname/../../scripts, so scripts needs to be at tmpBase level
      const scriptsLink = path.join(tmpBase, 'scripts');
      const workspaceScripts = path.resolve(repoRoot, 'scripts');

      if (fs.existsSync(workspaceScripts)) {
        console.log(`[Playwright DB] Creating symlink from ${scriptsLink} to ${workspaceScripts}`);
        await fsp.symlink(workspaceScripts, scriptsLink, 'dir').catch((err) => {
          console.log('[Playwright DB] Could not symlink scripts directory:', err.message);
        });
        if (fs.existsSync(scriptsLink)) {
          console.log(`[Playwright DB] scripts symlink created successfully`);
        } else {
          console.log(`[Playwright DB] Warning: scripts symlink was not created`);
        }
      } else {
        console.log(`[Playwright DB] Warning: scripts directory not found at ${workspaceScripts}`);
      }

      // Create symlink to shared directory (at repo root level)
      const sharedLink = path.join(tmpBase, 'shared');
      const workspaceShared = path.resolve(repoRoot, 'shared');

      if (fs.existsSync(workspaceShared)) {
        console.log(`[Playwright DB] Creating symlink from ${sharedLink} to ${workspaceShared}`);
        await fsp.symlink(workspaceShared, sharedLink, 'dir').catch((err) => {
          console.log('[Playwright DB] Could not symlink shared directory:', err.message);
        });
        if (fs.existsSync(sharedLink)) {
          console.log(`[Playwright DB] shared symlink created successfully`);
        } else {
          console.log(`[Playwright DB] Warning: shared symlink was not created`);
        }
      } else {
        console.log(`[Playwright DB] Warning: shared directory not found at ${workspaceShared}`);
      }

      // Copy CE first
      if (ceExists) {
        console.log(`[Playwright DB] Copying CE migrations from ${ceDir}`);
        await copyDir(ceDir, migrationsDir);
      }

      // Overlay EE (overwrites collisions)
      if (eeExists) {
        console.log(`[Playwright DB] Overlaying EE migrations from ${eeDir}`);
        await copyDir(eeDir, migrationsDir);
      }

      console.log(`[Playwright DB] Merged migrations prepared in: ${migrationsDir}`);
    } else {
      // CE mode - use server migrations directly
      console.log('[Playwright DB] Running in CE mode - using server migrations');
      // Find repo root by looking for package.json with workspaces
      let repoRoot = process.cwd();
      while (repoRoot !== '/' && !fs.existsSync(path.join(repoRoot, 'package.json'))) {
        repoRoot = path.dirname(repoRoot);
      }
      // If we found a package.json, check if it has workspaces (indicating repo root)
      if (repoRoot !== '/') {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
          if (!pkg.workspaces) {
            // Go up one more level if this isn't the workspace root
            repoRoot = path.dirname(repoRoot);
          }
        } catch {
          // Ignore errors reading package.json
        }
      }
      migrationsDir = path.resolve(repoRoot, 'server/migrations');
    }

    // Find repo root for seeds directory
    let repoRoot = process.cwd();
    while (repoRoot !== '/' && !fs.existsSync(path.join(repoRoot, 'package.json'))) {
      repoRoot = path.dirname(repoRoot);
    }
    if (repoRoot !== '/') {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
        if (!pkg.workspaces) {
          repoRoot = path.dirname(repoRoot);
        }
      } catch {
        // Ignore errors
      }
    }

    const seedsDir = isEE
      ? path.resolve(repoRoot, 'ee/server/seeds/dev')
      : path.resolve(repoRoot, 'server/seeds/dev');

    await db.migrate.latest({
      directory: migrationsDir,
      loadExtensions: ['.cjs', '.js'],
    });

    // Try to run seeds, but don't fail if they don't exist
    if (fs.existsSync(seedsDir)) {
      await db.seed
        .run({ directory: seedsDir, loadExtensions: ['.cjs', '.js'] })
        .catch(() => undefined);
    }
  } finally {
    await db.destroy().catch(() => undefined);

    // Clean up temp directory if it was created
    if (tmpBase) {
      await fsp.rm(tmpBase, { recursive: true, force: true }).catch(() => undefined);
    }
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
