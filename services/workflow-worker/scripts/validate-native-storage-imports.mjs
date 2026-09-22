#!/usr/bin/env node

/**
 * Native workflow storage import validation.
 *
 * The workflow-worker and email-service run as plain `node` processes. The
 * `@alga-psa/storage` barrel re-exports modules that transitively import
 * `@alga-psa/validation` in a way that fails under native ESM
 * (`ERR_MODULE_NOT_FOUND ... validation/src/lib/utils`). The narrow subpath
 * exports load fine, so runtime code must use those instead of the barrel
 * (regression: alga-2026-0002491).
 *
 * This check scans the built worker output for every `@alga-psa/storage`
 * import specifier, rejects the bare barrel, and then dynamically imports each
 * subpath under plain node to prove it resolves. A future barrel import fails
 * CI here instead of only at runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVICE_ROOT, '../..');
const DIST_ROOT = path.resolve(
  process.env.WORKFLOW_WORKER_STORAGE_DIST_ROOT || path.join(SERVICE_ROOT, 'dist'),
);
const STORAGE_DIST = path.join(REPO_ROOT, 'packages', 'storage', 'dist');

const BARREL = '@alga-psa/storage';
const STORAGE_SPECIFIER = /(?:import\s*\(\s*|from\s*|require\s*\(\s*|import\s+)['"](@alga-psa\/storage(?:\/[^'"]*)?)['"]/g;

function ensureStorageBuilt() {
  if (fs.existsSync(STORAGE_DIST)) return;
  const npmExec = process.env.npm_execpath;
  const result = spawnSync(
    npmExec ? process.execPath : 'npm',
    npmExec ? [npmExec, 'run', 'build', '--workspace=@alga-psa/storage'] : ['run', 'build', '--workspace=@alga-psa/storage'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to build @alga-psa/storage: ${result.error?.message ?? result.stderr}`);
  }
}

function collectJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (/\.(?:m|c)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

function collectStorageSpecifiers() {
  const specifiers = new Set();
  for (const file of collectJsFiles(DIST_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(STORAGE_SPECIFIER)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

async function validate() {
  ensureStorageBuilt();

  if (!fs.existsSync(DIST_ROOT)) {
    throw new Error(`built worker output not found at ${DIST_ROOT}`);
  }

  const specifiers = collectStorageSpecifiers();
  if (specifiers.size === 0) {
    console.log('Native workflow storage import validation passed (no @alga-psa/storage imports).');
    return;
  }

  const barrelUsers = [...specifiers].filter((specifier) => specifier === BARREL);
  if (barrelUsers.length > 0) {
    throw new Error(
      `native workflow runtime must not import the ${BARREL} barrel; use the narrow subpaths instead`,
    );
  }

  for (const specifier of [...specifiers].sort()) {
    try {
      await import(specifier);
    } catch (error) {
      throw new Error(
        `storage subpath ${specifier} failed to resolve under plain node: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    `Native workflow storage import validation passed (${specifiers.size} subpath import${specifiers.size === 1 ? '' : 's'}).`,
  );
}

validate().catch((error) => {
  console.error('\nNative workflow storage import validation failed.\n');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
