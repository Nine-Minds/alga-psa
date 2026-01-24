// Runs CE + EE migrations locally by copying into a temp directory
// and invoking knex with MIGRATIONS_DIR pointing to that temp path.
// Overlay rule: EE files overwrite CE files when names collide.
//
// Usage: node run-ee-migrations.js [action]
//   action: latest (default), down, status

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
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
  const ceDir = path.resolve(repoRoot, 'server', 'migrations');
  const eeDir = path.resolve(repoRoot, 'ee', 'server', 'migrations');

  // Validate inputs
  const ceExists = fs.existsSync(ceDir);
  const eeExists = fs.existsSync(eeDir);
  if (!ceExists && !eeExists) {
    console.error('No migrations found: neither server/migrations nor ee/server/migrations exist.');
    process.exit(1);
  }

  // Create temp workspace under OS tmp
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'alga-ee-migrations-'));
  const tmpMigrations = path.join(tmpBase, 'migrations');
  await ensureDir(tmpMigrations);

  // Copy CE first
  if (ceExists) {
    console.log(`Copying CE migrations from ${ceDir} -> ${tmpMigrations}`);
    await copyDir(ceDir, tmpMigrations);
  } else {
    console.log('CE migrations folder not found; continuing with EE only.');
  }

  // Overlay EE (overwrites collisions)
  if (eeExists) {
    console.log(`Overlaying EE migrations from ${eeDir} -> ${tmpMigrations}`);
    await copyDir(eeDir, tmpMigrations);
  } else {
    console.log('EE migrations folder not found; continuing with CE only.');
  }

  console.log(`Prepared merged migrations in: ${tmpMigrations}`);

  // Run knex migrate:<action> with MIGRATIONS_DIR override and migration env (uses admin connection)
  const serverDir = path.resolve(repoRoot, 'server');
  const knexfilePath = path.resolve(serverDir, 'knexfile.cjs');
  const env = { ...process.env, MIGRATIONS_DIR: tmpMigrations, NODE_ENV: 'migration' };

  const knexAction = `migrate:${action}`;
  console.log(`Running knex ${knexAction}...`);
  const debugArgs = env.EE_MIGRATIONS_DEBUG ? ['--debug'] : [];
  if (env.EE_MIGRATIONS_DEBUG) {
    console.log('EE_MIGRATIONS_DEBUG=1 enabled: knex will print debug output.');
  }
  await run('npx', ['knex', knexAction, '--knexfile', knexfilePath, '--env', 'migration', ...debugArgs], { env, cwd: serverDir });

  console.log(`Migration ${action} completed successfully.`);
  console.log(`Temporary migrations directory preserved at: ${tmpMigrations}`);
  console.log('Delete it when you are done, e.g. rm -rf', tmpBase);
}

main().catch((err) => {
  console.error('EE migration run failed:', err?.message || err);
  process.exit(1);
});
