// Runs CE + EE migrations by merging both migration sets into a single
// directory *under server/* and invoking knex with MIGRATIONS_DIR pointing at
// it. Overlay rule: EE files overwrite CE files when names collide.
//
// Why under server/ (and NOT os.tmpdir())? Migrations resolve sibling resources
// relative to their own file location:
//   - bare requires (e.g. require('pg-boss')) resolve via the nearest
//     node_modules found walking up the tree.
//   - file reads like path.resolve(__dirname, '..', 'src/invoice-templates/...')
//     resolve to <migrationsDir>/../src.
// Both only work when the merged dir sits one level under server/, so that
// `..` === server/ (giving server/node_modules and server/src). A dir in
// /tmp has neither nearby and breaks migrations that import modules or read
// source files. This mirrors the Docker setup container, which builds
// /app/server/combined-migrations for exactly the same reason.
//
// Usage: node run-ee-migrations.js [action]
//   action: latest (default), down, status
// Env:
//   EE_MIGRATIONS_DEBUG=1    pass --debug to knex
//   EE_MIGRATIONS_KEEP_TMP=1 keep the merged dir after running (for debugging)

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function copyDir(src, dest) {
  // Node 16+ supports fs.cp; fallback to manual copy if not available
  if (fs.cp) {
    await fsp.cp(src, dest, { recursive: true, force: true });
    return;
  }
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

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  // Parse action from command line args (default: latest)
  const validActions = ['latest', 'down', 'status'];
  const action = process.argv[2] || 'latest';

  if (!validActions.includes(action)) {
    console.error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
    process.exit(1);
  }

  // Resolve repo root from server/scripts/
  const repoRoot = path.resolve(__dirname, '..', '..');
  const serverDir = path.resolve(repoRoot, 'server');
  const ceDir = path.resolve(serverDir, 'migrations');
  const eeDir = path.resolve(repoRoot, 'ee', 'server', 'migrations');

  // Validate inputs
  const ceExists = fs.existsSync(ceDir);
  const eeExists = fs.existsSync(eeDir);
  if (!ceExists && !eeExists) {
    console.error('No migrations found: neither server/migrations nor ee/server/migrations exist.');
    process.exit(1);
  }

  // Create the merged workspace DIRECTLY under server/ (one level down) so that
  // `path.resolve(__dirname, '..', ...)` inside a migration points at server/,
  // and bare requires resolve via server/node_modules -> repo node_modules.
  // See the file header for the full rationale. The dir is removed in `finally`.
  const mergedDir = path.join(serverDir, `.ee-combined-migrations-${process.pid}-${Date.now()}`);
  await ensureDir(mergedDir);

  const cleanup = async () => {
    if (process.env.EE_MIGRATIONS_KEEP_TMP) {
      console.log(`EE_MIGRATIONS_KEEP_TMP set; leaving merged migrations at: ${mergedDir}`);
      return;
    }
    try {
      await fsp.rm(mergedDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Warning: failed to clean up ${mergedDir}: ${err?.message || err}`);
    }
  };

  try {
    // Copy CE first (recursive: brings utils/ and other helper trees that
    // migrations import via relative requires).
    if (ceExists) {
      console.log(`Copying CE migrations from ${ceDir} -> ${mergedDir}`);
      await copyDir(ceDir, mergedDir);
    } else {
      console.log('CE migrations folder not found; continuing with EE only.');
    }

    // Overlay EE (overwrites collisions)
    if (eeExists) {
      console.log(`Overlaying EE migrations from ${eeDir} -> ${mergedDir}`);
      await copyDir(eeDir, mergedDir);
    } else {
      console.log('EE migrations folder not found; continuing with CE only.');
    }

    console.log(`Prepared merged migrations in: ${mergedDir}`);

    // Run knex migrate:<action> with MIGRATIONS_DIR override and migration env
    // (uses admin connection). NODE_PATH is set as a backstop so bare requires
    // in migrations resolve regardless of where node is launched from.
    const knexfilePath = path.resolve(serverDir, 'knexfile.cjs');
    const nodePath = [
      path.join(serverDir, 'node_modules'),
      path.join(repoRoot, 'node_modules'),
      process.env.NODE_PATH,
    ].filter(Boolean).join(path.delimiter);
    const env = {
      ...process.env,
      MIGRATIONS_DIR: mergedDir,
      NODE_ENV: 'migration',
      NODE_PATH: nodePath,
    };

    const knexAction = `migrate:${action}`;
    console.log(`Running knex ${knexAction}...`);
    const debugArgs = env.EE_MIGRATIONS_DEBUG ? ['--debug'] : [];
    if (env.EE_MIGRATIONS_DEBUG) {
      console.log('EE_MIGRATIONS_DEBUG=1 enabled: knex will print debug output.');
    }
    await run('npx', ['knex', knexAction, '--knexfile', knexfilePath, '--env', 'migration', ...debugArgs], { env, cwd: serverDir });

    console.log(`Migration ${action} completed successfully.`);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('EE migration run failed:', err?.message || err);
  process.exit(1);
});
