#!/usr/bin/env node
// Runs the Tier-1 integration gate from the explicit manifest at
// server/src/test/integration/tier1.manifest.json. Every manifest entry must
// exist on disk — a missing path is a hard error, so a moved or deleted suite
// breaks the gate instead of silently leaving it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'server');
const manifestPath = path.join(serverDir, 'src/test/integration/tier1.manifest.json');

const { paths } = JSON.parse(readFileSync(manifestPath, 'utf8'));
const missing = paths.filter((p) => !existsSync(path.join(serverDir, p)));
if (missing.length > 0) {
  console.error('tier1.manifest.json entries not found on disk:');
  for (const p of missing) console.error(`  - ${p}`);
  console.error('Update the manifest in the same PR that moves or deletes a suite.');
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  'npx',
  ['vitest', 'run', ...paths, '--coverage.enabled=false', ...extraArgs],
  { cwd: serverDir, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
