#!/usr/bin/env node
// Runs the Tier-1 integration gate: the explicit manifest at
// server/src/test/integration/tier1.manifest.json, unioned with every
// integration suite whose static import graph reaches a file changed since
// TIER1_BASE_SHA (the PR base, or the previous tip on push). The manifest is
// the fixed floor — money paths, intake, authorization, journeys — and the
// affected set is what stops a change deep in shared/services/email from
// merging green while its only covering suite waits for the nightly.
//
// Every manifest entry must exist on disk — a missing path is a hard error, so
// a moved or deleted suite breaks the gate instead of silently leaving it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'server');
const manifestPath = path.join(serverDir, 'src/test/integration/tier1.manifest.json');
const integrationDir = 'src/test/integration';

function warn(message) {
  // `::warning::` surfaces in the GitHub checks UI; plain text everywhere else.
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `WARNING: ${message}`);
}

// Read actual runner collection rather than interpreting include/exclude globs.
function collectIntegrationFiles(args) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'alga-affected-'));
  const output = path.join(temporary, 'files.json');
  try {
    const list = spawnSync(
      process.execPath,
      [path.join(serverDir, 'node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', ...args, `--json=${output}`],
      { cwd: serverDir, encoding: 'utf8' },
    );
    if (list.status !== 0) throw new Error(list.stderr || 'Vitest collection failed');
    const files = JSON.parse(readFileSync(output, 'utf8'));
    if (!Array.isArray(files)) throw new Error('Missing collected file array');
    return files.map((entry) => {
      if (typeof entry.file !== 'string') throw new Error('Missing file identity');
      const file = path.relative(serverDir, path.resolve(serverDir, entry.file)).split(path.sep).join('/');
      if (!file.startsWith(`${integrationDir}/`)) throw new Error(`Unexpected affected file: ${file}`);
      return file;
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function affectedSuites(base) {
  try {
    return collectIntegrationFiles(['--changed', base, integrationDir]);
  } catch (error) {
    warn(`Affected collection failed; running the full integration suite. ${error.message}`);
    return null;
  }
}

function coveredByManifest(file, manifestPaths) {
  return manifestPaths.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

const { paths } = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(paths) || !paths.length || paths.some((entry) => typeof entry !== 'string' || !entry.startsWith(`${integrationDir}/`) || entry.split('/').includes('..'))) {
  throw new Error('tier1.manifest.json requires a nonempty floor of paths inside src/test/integration');
}
const missing = paths.filter((p) => !existsSync(path.join(serverDir, p)));
if (missing.length > 0) {
  console.error('tier1.manifest.json entries not found on disk:');
  for (const p of missing) console.error(`  - ${p}`);
  console.error('Update the manifest in the same PR that moves or deletes a suite.');
  process.exit(1);
}

// Existing directories can still be empty or excluded by the actual runner.
// Verify every floor entry collects tests even when an affected/full selection
// would otherwise run unrelated files and conceal that missing coverage.
const floorFiles = collectIntegrationFiles(paths);
for (const entry of paths) {
  if (!floorFiles.some((file) => coveredByManifest(file, [entry]))) {
    throw new Error(`Tier-1 floor entry collects no tests: ${entry}`);
  }
}

const base = process.env.TIER1_BASE_SHA?.trim();
const changed = readChangedFiles({ cwd: repoRoot, base, head: process.env.TIER1_HEAD_SHA || 'HEAD' });
const decision = selectIntegration(changed);
// Direct/manual invocation still runs the manifest on documentation-only
// changes. Only the workflow's explicit selection step may skip the job.
let selection = paths;
let mode = decision.reason;
if (decision.full) {
  selection = [integrationDir];
} else if (decision.shouldRun) {
  const affected = affectedSuites(base);
  if (affected === null) {
    selection = [integrationDir];
    mode = 'full integration suite (import graph unavailable)';
  } else {
    const extra = affected.filter((file) => !coveredByManifest(file, paths));
    selection = [...paths, ...extra];
    mode = `manifest (${paths.length} entries) + ${extra.length} affected suites vs ${base.slice(0, 10)}`;
    for (const file of extra) console.log(`  affected: ${file}`);
  }
}
console.log(`tier1 gate: ${mode}`);

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [path.join(serverDir, 'node_modules/vitest/vitest.mjs'), 'run', ...selection, '--coverage.enabled=false', ...extraArgs],
  { cwd: serverDir, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
