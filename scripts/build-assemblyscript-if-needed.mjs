#!/usr/bin/env node
/**
 * Skip the assemblyscript invoice-template build when its outputs are already
 * newer than its sources. The full asc build (with `npm install`) costs ~2 s
 * per `npm run build`; this short-circuits when nothing changed.
 *
 * Force a full rebuild with `npm run build:assemblyscript:force`.
 */
import { spawnSync } from 'node:child_process';
import { statSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, 'server/src/invoice-templates/assemblyscript');
const OUT_DIR = resolve(ROOT, 'dist/server/src/invoice-templates/standard');
const OUTPUTS = ['standard-default.wasm', 'standard-detailed.wasm'];

function newestMtime(dir, exts = new Set(['.ts'])) {
  let max = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === 'temp_compile') continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      const sub = newestMtime(full, exts);
      if (sub > max) max = sub;
    } else if (name.isFile() && [...exts].some((e) => name.name.endsWith(e))) {
      const t = statSync(full).mtimeMs;
      if (t > max) max = t;
    }
  }
  return max;
}

function needsBuild() {
  if (!existsSync(OUT_DIR)) return true;
  for (const f of OUTPUTS) if (!existsSync(join(OUT_DIR, f))) return true;
  const outMtime = Math.min(...OUTPUTS.map((f) => statSync(join(OUT_DIR, f)).mtimeMs));
  const srcMtime = newestMtime(SRC_DIR);
  return srcMtime > outMtime;
}

if (!needsBuild()) {
  console.log('[build:assemblyscript] outputs up to date — skipping');
  process.exit(0);
}

console.log('[build:assemblyscript] sources changed — rebuilding');
const r = spawnSync(
  'sh',
  ['-c', 'cd server/src/invoice-templates/assemblyscript && npm install --cache ../../../../.npm-cache && npm run build'],
  { cwd: ROOT, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
