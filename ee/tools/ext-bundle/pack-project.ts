/**
 * Stage a bundle from a project directory (using its manifest.json) and pack it.
 *
 * Usage:
 *   node ee/tools/ext-bundle/pack-project.ts --project ee/extensions/softwareone-ext --out dist/softwareone/bundle.tar.zst
 *
 * Behavior:
 *   - Validates <project>/manifest.json exists (v2 manifest expected).
 *   - Creates a temporary staging directory.
 *   - Copies known bundle paths if present: manifest.json, ui/, dist/, artifacts/, precompiled/, SIGNATURE, sbom.spdx.json
 *   - Invokes pack.ts to produce bundle.tar.zst and sidecar sha256.
 *   - Prints through the sha256 line from pack.ts on success.
 */

import { mkdtempSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function die(msg: string, code = 1): never {
  console.error(`[pack-project] ${msg}`);
  process.exit(code);
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.split('=');
      const key = k.replace(/^--/, '');
      if (typeof v === 'string') {
        out[key] = v;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          out[key] = next;
          i++;
        } else {
          out[key] = true;
        }
      }
    }
  }
  return out;
}

function ensureDir(p: string) {
  try { mkdirSync(p, { recursive: true }); } catch {}
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const project = flags.project ? resolve(String(flags.project)) : null;
  const outPath = flags.out ? resolve(String(flags.out)) : null;
  const force = Boolean(flags.force);
  if (!project || !outPath) {
    die('Usage: node ee/tools/ext-bundle/pack-project.ts --project <path> --out <path/to/bundle.tar.zst> [--force]');
  }

  const manifestPath = join(project, 'manifest.json');
  if (!existsSync(manifestPath)) die(`manifest.json not found in project: ${project}`);

  // Create staging dir
  const stage = mkdtempSync(join(tmpdir(), 'alga-ext-stage-'));

  // Copy known bundle bits if present
  const entries = ['manifest.json', 'ui', 'dist', 'artifacts', 'precompiled', 'SIGNATURE', 'sbom.spdx.json'];
  for (const rel of entries) {
    const src = join(project, rel);
    if (existsSync(src)) {
      cpSync(src, join(stage, rel), { recursive: true });
      console.log(`[pack-project] staged: ${rel}`);
    }
  }

  // Ensure UI can import built ESM from a path under ui/
  // If project has dist/, also mirror it to ui/dist for static serving
  const projDist = join(project, 'dist');
  if (existsSync(projDist)) {
    const uiDist = join(stage, 'ui', 'dist');
    ensureDir(dirname(uiDist));
    cpSync(projDist, uiDist, { recursive: true });
    console.log('[pack-project] staged: ui/dist (mirrored from dist)');
  }

  // Ensure output dir exists
  ensureDir(dirname(outPath));

  // Invoke pack.ts using Node (same directory)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packScript = resolve(__dirname, 'pack.ts');
  const res = spawnSync(process.execPath, [packScript, stage, outPath, ...(force ? ['--force'] : [])], { stdio: 'inherit' });
  if ((res.status ?? 1) !== 0) die(`pack.ts failed with code ${res.status}`);
}

try { main(); } catch (e) { die((e as Error).message); }
