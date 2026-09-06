import { execFileSync } from 'node:child_process';
import { normalizeTestFile } from './test-execution-evidence.mjs';

// Include new, untracked tests during local development. Deleted tracked tests
// remain candidates until staged, so an accidental deletion cannot disappear
// from a local inventory without explanation.
export function repositoryTestFiles(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return [...new Set(files.split('\0').filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)))].sort();
}

// These tests are excluded from the DB-less unit job. Server unit-directory
// DB tests need the same positive assignment as colocated package DB tests.
// Integration/infrastructure directories retain their own database lanes.
export function isWorkspaceDbTest(file) {
  return /^(packages|shared|ee\/packages|server\/src\/test\/unit)\//.test(file)
    && /\.db\.test\.[cm]?[jt]sx?$/.test(file);
}

export function isNodeToolingTest(file) {
  return /^(scripts\/tests|tools\/i18n\/tests|tools\/workflow-harness\/tests|tools\/microsoft-graph|e2e-tests\/harness|test-harness\/graph-emulator|eslint-plugin-custom-rules)\//.test(file)
    && /\.(test|spec)\.[cm]?js$/.test(file);
}

// These roots are not covered by the server unit command or package-local
// Nx test targets. Keep runtime requirements explicit during reconciliation.
export function isAdditionalWorkspaceTest(file, lane) {
  if (!/^(services\/(email-service|workflow-worker)|sdk|ee\/server\/src\/lib)\//.test(file)
    || !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
    || /(^|\/)(node_modules|dist)\//.test(file)) return false;
  const runtime = /\.integration\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  if (lane === 'workspace-runtime') return runtime;
  if (lane === 'workspace-unit') return !runtime && !/\.(db|playwright)\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  throw new Error(`Unknown workspace lane: ${lane}`);
}

// Collections come from the runners, not from a second interpretation of
// their include/exclude globs. Inventory proves discoverability only; execution
// evidence is separately required before a suite can satisfy readiness.
export function reconcileDiscovery({ root, candidates, collections, exclusions = [], today = new Date().toISOString().slice(0, 10) }) {
  const failures = [];
  const normalize = (file) => normalizeTestFile(file, root);
  const files = candidates.map(normalize);
  const candidateSet = new Set(files);
  if (!files.length) failures.push('Mandatory test inventory is empty');
  if (candidateSet.size !== files.length) failures.push('Duplicate candidate identities');
  if (!collections.length) failures.push('No runner collections supplied');
  const runners = new Set();
  const collectedBy = new Map();
  for (const collection of collections) {
    const { runner, files: collected } = collection;
    if (!runner || runners.has(runner)) failures.push(`Missing or duplicate runner identity: ${runner}`);
    runners.add(runner);
    if (collection.status !== 'passed') failures.push(`Runner collection failed: ${runner}`);
    if (!Array.isArray(collected) || !collected.length) {
      failures.push(`Empty mandatory collection: ${runner}`);
      continue;
    }
    const seen = new Set();
    for (const entry of collected) {
      const file = normalize(typeof entry === 'string' ? entry : entry.file);
      if (seen.has(file)) failures.push(`Duplicate collected identity: ${runner}: ${file}`);
      seen.add(file);
      if (!candidateSet.has(file)) failures.push(`Collected test outside candidate inventory: ${runner}: ${file}`);
      if (!collectedBy.has(file)) collectedBy.set(file, []);
      collectedBy.get(file).push(runner);
    }
  }
  const excluded = new Map();
  for (const exclusion of exclusions) {
    const file = normalize(exclusion.file);
    if (excluded.has(file)) failures.push(`Duplicate exclusion: ${file}`);
    if (!candidateSet.has(file)) failures.push(`Stale exclusion (test moved or removed): ${file}`);
    if (collectedBy.has(file)) failures.push(`Remove exclusion for collected test: ${file}`);
    if (!exclusion.owner?.trim() || !exclusion.reason?.trim() || !exclusion.issue?.trim()) {
      failures.push(`Exclusion requires owner, reason and tracking issue: ${file}`);
    }
    const date = exclusion.expires;
    const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date <= today) {
      failures.push(`Expired or invalid exclusion: ${file}`);
    }
    excluded.set(file, exclusion);
  }
  const unmatched = files.filter((file) => !collectedBy.has(file) && !excluded.has(file));
  for (const file of unmatched) failures.push(`No runner collects test: ${file}`);
  return {
    schemaVersion: 1, status: failures.length ? 'failed' : 'passed',
    candidates: files, unmatched,
    tests: files.map((file) => ({ file, runners: collectedBy.get(file) ?? [], exclusion: excluded.get(file) ?? null })),
    failures,
  };
}
