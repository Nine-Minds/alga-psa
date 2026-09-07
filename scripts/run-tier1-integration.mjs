#!/usr/bin/env node
// Runs the Tier-1 integration gate: the explicit manifest at
// server/src/test/integration/tier1.manifest.json, unioned with every
// server- or Temporal-owned integration suite whose static import graph reaches a file changed since
// TIER1_BASE_SHA (the PR base, or the previous tip on push). The manifest is
// the fixed floor — money paths, intake, authorization, journeys — and the
// affected set is what stops a change deep in shared/services/email from
// merging green while its only covering suite waits for the nightly.
//
// Every manifest entry must exist on disk — a missing path is a hard error, so
// a moved or deleted suite breaks the gate instead of silently leaving it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { reconcileDiscovery, repositoryTestFiles } from './lib/test-discovery.mjs';
import { partitionTestFiles } from './lib/test-sharding.mjs';
import { testRevision } from './lib/test-revision.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'server');
const manifestPath = path.join(serverDir, 'src/test/integration/tier1.manifest.json');
const integrationDir = 'src/test/integration';
const integrationDirs = [integrationDir, '../ee/temporal-workflows/src/__tests__/integration'];
const isIntegrationPath = (file) => path.posix.normalize(file) === file && integrationDirs.some(dir => file === dir || file.startsWith(`${dir}/`));

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
      if (!isIntegrationPath(file)) throw new Error(`Unexpected affected file: ${file}`);
      return file;
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function affectedSuites(base) {
  try {
    return collectIntegrationFiles(['--changed', base, ...integrationDirs]);
  } catch (error) {
    warn(`Affected collection failed; running the full integration suite. ${error.message}`);
    return null;
  }
}

function coveredByManifest(file, manifestPaths) {
  return manifestPaths.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

const extraArgs = process.argv.slice(2);
const output = path.join(repoRoot, 'test-results/integration');
mkdirSync(output, { recursive: true });
const save = (name, value) => writeFileSync(path.join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
for (const name of ['collected', 'collected-tests', 'discovery', 'evidence', 'results']) save(name, null);
// Preserve the existing metrics/report destination supplied by CI or developers.
const reportArg = extraArgs.findLast(arg => /^--outputFile(?:\.json)?=/.test(arg));
const reportPath = path.resolve(serverDir, reportArg ? reportArg.slice(reportArg.indexOf('=') + 1) : 'test-results-integration.json');
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, 'null\n');

const { paths } = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(paths) || !paths.length || paths.some((entry) => typeof entry !== 'string' || !isIntegrationPath(entry))) {
  throw new Error('tier1.manifest.json requires a nonempty floor of paths inside owned integration directories');
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
  selection = integrationDirs;
} else if (decision.shouldRun) {
  const affected = affectedSuites(base);
  if (affected === null) {
    selection = integrationDirs;
    mode = 'full integration suite (import graph unavailable)';
  } else {
    const extra = affected.filter((file) => !coveredByManifest(file, paths));
    selection = [...paths, ...extra];
    mode = `manifest (${paths.length} entries) + ${extra.length} affected suites vs ${base.slice(0, 10)}`;
    for (const file of extra) console.log(`  affected: ${file}`);
  }
}
console.log(`tier1 gate: ${mode}`);

const before = testRevision(repoRoot);
let evidence;
let allFiles = [];
const index = Number(process.env.INTEGRATION_SHARD_INDEX || '1');
const total = Number(process.env.INTEGRATION_SHARD_TOTAL || '1');
try {
  const complete = collectIntegrationFiles(selection).map(file => ({ file: path.join(serverDir, file) }));
  allFiles = complete.map(entry => path.relative(repoRoot, entry.file).split(path.sep).join('/')).sort();
  const candidates = repositoryTestFiles(repoRoot).filter(file =>
    coveredByManifest(path.relative(serverDir, path.join(repoRoot, file)).split(path.sep).join('/'), selection));
  const discovery = reconcileDiscovery({ root: repoRoot, candidates, collections: [{ runner: 'integration', status: 'passed', files: complete }] });
  save('discovery', discovery);
  if (discovery.status !== 'passed') throw new Error(discovery.failures.join('\n'));
  const assigned = partitionTestFiles(allFiles, index, total);
  const filters = assigned.map(file => path.join(repoRoot, file));
  const collected = collectIntegrationFiles(filters).map(file => ({ file: path.join(serverDir, file) }));
  const actual = collected.map(entry => path.relative(repoRoot, entry.file).split(path.sep).join('/')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(assigned)) throw new Error('Integration filters did not collect the exact assigned shard');
  save('collected', collected);
  const testPath = path.join(output, 'collected-tests.json');
  const collection = spawnSync(process.execPath,
    [path.join(serverDir, 'node_modules/vitest/vitest.mjs'), 'list', ...filters, `--json=${testPath}`],
    { cwd: serverDir, stdio: 'inherit' });
  if (collection.status !== 0) throw new Error('Integration test collection failed');
  const collectedTests = JSON.parse(readFileSync(testPath, 'utf8'));
  const args = extraArgs.filter(arg => !/^--outputFile(?:\.json)?=/.test(arg) && arg !== '--reporter=json');
  if (!args.some(arg => arg.startsWith('--reporter'))) args.push('--reporter=default');
  const result = spawnSync(process.execPath,
    [path.join(serverDir, 'node_modules/vitest/vitest.mjs'), 'run', ...filters, '--coverage.enabled=false', ...args,
      '--reporter=json', `--outputFile.json=${reportPath}`],
    { cwd: serverDir, stdio: 'inherit' });
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  save('results', report);
  evidence = reconcileExecution({ collected, collectedTests, report, root: repoRoot,
    suite: 'integration', revision: before.revision, exitCode: result.status });
} catch (error) {
  evidence = { schemaVersion: 1, suite: 'integration', revision: before.revision, status: 'failed', failures: [error.message] };
}
const after = testRevision(repoRoot);
evidence.selection = { mode: 'selected', reason: mode, paths: selection, manifest: paths, allFiles, filters: [], shard: { index, total } };
if (before.dirty || after.dirty) {
  evidence.status = 'failed';
  evidence.failures.push('Integration checkout must remain clean');
}
evidence.source = { before, after };
evidence.workingTreeDirty = Boolean(before.dirty || after.dirty);
if (before.revision !== after.revision) {
  evidence.status = 'failed';
  evidence.failures.push('Repository revision changed during integration execution');
}
save('evidence', evidence);
for (const failure of evidence.failures) console.error(failure);
process.exit(evidence.status === 'passed' ? 0 : 1);
