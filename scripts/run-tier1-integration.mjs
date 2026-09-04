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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'server');
const manifestPath = path.join(serverDir, 'src/test/integration/tier1.manifest.json');
const integrationDir = 'src/test/integration';

// Changes the import graph cannot see: DB schema and seed data, the vitest
// harness itself, dependency versions, this gate. Any of these runs the whole
// integration directory instead of a subset.
const FULL_SUITE_TRIGGERS = [
  /^server\/migrations\//,
  /^ee\/server\/migrations\//,
  /^server\/seeds\//,
  /^ee\/server\/seeds\//,
  /^server\/vitest\.config\.ts$/,
  /^server\/vitest\.globalSetup\.js$/,
  /^server\/src\/test\/setup\.ts$/,
  /^server\/test-utils\//,
  /^\.env\.localtest$/,
  /^package(-lock)?\.json$/,
  /^server\/package\.json$/,
  /^scripts\/run-tier1-integration\.mjs$/,
  /^\.github\/workflows\/integration-tests\.yml$/,
];

function warn(message) {
  // `::warning::` surfaces in the GitHub checks UI; plain text everywhere else.
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `WARNING: ${message}`);
}

function git(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

// The base to diff against, or null when there is nothing meaningful to diff
// (no SHA given, the null SHA of a new branch / force push, or a SHA the
// checkout does not have). Falling back to the manifest alone is today's gate,
// so a missing base can never make the gate narrower than it used to be.
function resolveBase() {
  const base = process.env.TIER1_BASE_SHA?.trim();
  if (!base) return null;
  if (/^0+$/.test(base)) {
    warn('TIER1_BASE_SHA is the null SHA (new branch or force push); running the manifest only.');
    return null;
  }
  if (git(['cat-file', '-e', `${base}^{commit}`]).status !== 0) {
    warn(`TIER1_BASE_SHA ${base} is not in this checkout (shallow clone?); running the manifest only.`);
    return null;
  }
  return base;
}

function changedFiles(base) {
  const diff = git(['diff', '--name-only', base]);
  if (diff.status !== 0) {
    warn(`git diff against ${base} failed; running the manifest only.\n${diff.stderr}`);
    return null;
  }
  return diff.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Suites vitest marks as affected by the diff. Returns null when vitest cannot
// walk the graph, which must widen the gate rather than narrow it.
function affectedSuites(base) {
  const list = spawnSync(
    'npx',
    ['vitest', 'list', '--filesOnly', '--changed', base, integrationDir],
    { cwd: serverDir, encoding: 'utf8' },
  );
  if (list.status !== 0) {
    warn(`vitest list --changed failed; running the full integration suite instead.\n${list.stderr}`);
    return null;
  }
  return list.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${integrationDir}/`));
}

function coveredByManifest(file, manifestPaths) {
  return manifestPaths.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

const { paths } = JSON.parse(readFileSync(manifestPath, 'utf8'));
const missing = paths.filter((p) => !existsSync(path.join(serverDir, p)));
if (missing.length > 0) {
  console.error('tier1.manifest.json entries not found on disk:');
  for (const p of missing) console.error(`  - ${p}`);
  console.error('Update the manifest in the same PR that moves or deletes a suite.');
  process.exit(1);
}

let selection = paths;
let mode = `manifest only (${paths.length} entries)`;

const base = resolveBase();
const changed = base ? changedFiles(base) : null;
if (changed) {
  const trigger = changed.find((file) => FULL_SUITE_TRIGGERS.some((re) => re.test(file)));
  if (trigger) {
    selection = [integrationDir];
    mode = `full integration suite (${trigger} changed; outside the import graph)`;
  } else {
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
}
console.log(`tier1 gate: ${mode}`);

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  'npx',
  ['vitest', 'run', ...selection, '--coverage.enabled=false', ...extraArgs],
  { cwd: serverDir, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
