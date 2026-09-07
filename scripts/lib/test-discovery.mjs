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
  if (/^server\/src\/(app|components|lib|services)\//.test(file)) {
    return /\.(db|integration)\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
  if (/^server\/migrations\/__tests__\//.test(file)) {
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
  return /^(packages|shared|ee\/packages|ee\/server\/src\/__tests__\/unit|server\/src\/test\/unit)\//.test(file)
    && /\.db\.test\.[cm]?[jt]sx?$/.test(file);
}

export function isNodeToolingTest(file) {
  return /^(scripts\/tests|tools\/i18n\/tests|tools\/workflow-harness\/tests|tools\/microsoft-graph|e2e-tests\/harness|test-harness\/graph-emulator|eslint-plugin-custom-rules)\//.test(file)
    && /\.(test|spec)\.[cm]?js$/.test(file);
}

export function isApplianceNodeTest(file) {
  return /^ee\/appliance\//.test(file)
    && /\.(test|spec)\.[cm]?js$/.test(file)
    && !/(^|\/)(node_modules|dist|overlay)\//.test(file);
}

// These roots are not covered by the server unit command or package-local
// Nx test targets. Keep runtime requirements explicit during reconciliation.
export function isAdditionalWorkspaceTest(file, lane) {
  if (lane === 'temporal-engine') {
    return file === 'ee/temporal-workflows/src/workflows/portal-domains/__tests__/registration.workflow.integration.test.ts'
      || /^ee\/temporal-workflows\/src\/workflows\/__tests__\/(tenant-product-upgrade-workflow|tenant-creation-appliance|sla-ticket-workflow|managed-email-domain-workflow)\.test\.ts$/.test(file);
  }
  if (lane === 'temporal-readiness') {
    return /^ee\/temporal-workflows\/src\/config\/__tests__\/.*\.test\.ts$/.test(file)
      || file === 'ee/temporal-workflows/src/workflows/__tests__/generic-job-workflow.temporal.test.ts'
      || /^ee\/temporal-workflows\/src\/workflows\/__tests__\/workflow-runtime-v2-(interpreter|run-workflow|simulator-contract)\.test\.ts$/.test(file)
      || /^ee\/temporal-workflows\/src\/workflows\/__tests__\/(marketing-fanout-workflow|ninjaone-token-refresh-workflow)\.test\.ts$/.test(file)
      || /^ee\/temporal-workflows\/src\/schedules\/__tests__\/.*\.test\.ts$/.test(file)
      || file === 'ee/temporal-workflows/src/db/__tests__/tenant-operations.email-settings.test.ts'
      || file === 'ee/temporal-workflows/src/db/__tests__/product-bootstrap-resolver.test.ts'
      || /^ee\/temporal-workflows\/src\/activities\/__tests__\/(portal-domain-activities(?:\.git)?|portal-domain-nextauth-url)\.test\.ts$/.test(file)
      || /^ee\/temporal-workflows\/src\/activities\/__tests__\/(workflow-runtime-v2-activities|sla-activities|marketing-activities|tenant-suspension-activities|tenant-email-ingestion-activities|product-upgrade-activities|comment-recovery-forwarding|email-activities-simple)\.test\.ts$/.test(file);
  }
  if (lane === 'api-e2e') {
    return /^server\/src\/test\/e2e\/api\//.test(file)
      && /\.e2e\.test\.ts$/.test(file);
  }
  if (lane === 'nx-tooling') {
    return /^tools\/nx-tests\//.test(file) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
  if (lane === 'ui-kit-showcase') {
    return /^ee\/extensions\/samples\/ui-kit-showcase\/test\//.test(file)
      && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
  if (lane === 'enterprise-integration') {
    return /^ee\/server\/src\/__tests__\/integration\//.test(file)
      && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
      && !/\.playwright\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
  if (lane === 'ai-gateway') {
    return /^services\/ai-gateway\/src\/test\//.test(file)
      && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
  if (lane === 'enterprise-unit') {
    return (/^ee\/server\/src\/(__tests__\/(unit|services)|components)\//.test(file)
      || /^ee\/packages\//.test(file))
      && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
      && !/(^|\/)(node_modules|dist)\//.test(file)
      && !/\.(integration|db|playwright)\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
  if (lane === 'server-colocated') {
    return (/^server\/src\/(app|components|lib|services)\//.test(file)
      || /^server\/src\/test\/[^/]+$/.test(file))
      && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
      && !/(^|\/)(node_modules|dist)\//.test(file)
      && !/\.(integration|db|playwright)\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  }
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
