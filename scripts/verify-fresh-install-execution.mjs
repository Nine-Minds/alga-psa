#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCandidateExecutionBundle } from './lib/candidate-execution-artifacts.mjs';
import { evaluateCandidateExecution } from './lib/candidate-execution-gate.mjs';
import { repositoryTestFiles, isAdditionalWorkspaceTest } from './lib/test-discovery.mjs';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';
import { testRevision } from './lib/test-revision.mjs';
import { verifyBrowserProviderReadiness } from './lib/browser-provider-readiness.mjs';
const providerPolicy = JSON.parse(readFileSync(new URL('./browser-provider-requirements.json', import.meta.url), 'utf8'));
if (providerPolicy.schemaVersion !== 1) throw new Error('Unsupported browser provider policy');

// These product journeys remain required even if a test file disappears from
// the candidate checkout. Newly landed journeys are added by tracked discovery.
const criticalBrowserFiles = [
  'e2e-tests/tests/inbound-email.spec.ts',
  'e2e-tests/tests/invoice-designer-persistence.spec.ts',
  'e2e-tests/tests/invoice-generation.spec.ts',
  'e2e-tests/tests/invoice-ticket-ownership.spec.ts',
  'e2e-tests/tests/login.spec.ts',
  'e2e-tests/tests/microsoft-calendar.spec.ts',
  'e2e-tests/tests/microsoft-mailbox.spec.ts',
  'e2e-tests/tests/microsoft-oauth-rejection.spec.ts',
  'e2e-tests/tests/microsoft-webhook-validation.spec.ts',
  'e2e-tests/tests/msp-access-redirects.spec.ts',
  'e2e-tests/tests/portal-discovery.spec.ts',
  'e2e-tests/tests/portal-identity.spec.ts',
  'e2e-tests/tests/portal-ticket-roundtrip.spec.ts',
  'e2e-tests/tests/qbo-export.spec.ts',
  'e2e-tests/tests/server-rendered-locale.spec.ts',
  'e2e-tests/tests/stripe-payment.spec.ts',
  'e2e-tests/tests/tenant-identity.spec.ts',
  'e2e-tests/tests/time-approval-invoice.spec.ts',
  'e2e-tests/tests/usage-invoice-preview.spec.ts',
  'e2e-tests/tests/xero-export.spec.ts',
];

function browserArtifact(directory, filename) {
  const found = [];
  // upload-artifact preserves the common ancestor of the workspace and runner
  // temp paths. Only these producer-owned suffixes identify primary evidence;
  // harness-results contains intentional failure/skip reports with the same names.
  const suffix = filename === 'browser-artifact-manifest.json'
    ? ['_temp', filename] : ['e2e-tests', 'execution-evidence', filename];
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name === filename
        && path.relative(directory, target).split(path.sep).slice(-suffix.length).join('/') === suffix.join('/')) found.push(target);
    }
  };
  visit(directory);
  if (found.length !== 1) throw new Error(`Expected one ${filename} browser artifact, received ${found.length}`);
  return found[0];
}

export function verifyFreshInstallExecution({ root, revision, input, sourceRoot = root, candidates, jobResults, shouldRun, runId, runAttempt }) {
  const failures = [], requirements = [], bundles = [], providerReadiness = [];
  // A passing new journey must become part of the permanent floor; otherwise
  // its later deletion could remove both candidate and collection evidence.
  for (const file of candidates.filter(file => file.startsWith('e2e-tests/tests/'))) {
    if (!criticalBrowserFiles.includes(file)) failures.push(`Unregistered mandatory browser journey: ${file}`);
  }
  for (const job of ['changes', 'production-browser']) {
    if (jobResults?.[job]?.result !== 'success') failures.push(`Required job ${job}: ${jobResults?.[job]?.result ?? 'missing'}`);
  }
  for (const job of ['browser-collection', 'build-images']) {
    const expected = shouldRun ? 'success' : 'skipped';
    if (jobResults?.[job]?.result !== expected) failures.push(`Required job ${job}: expected ${expected}, received ${jobResults?.[job]?.result ?? 'missing'}`);
  }
  if (typeof shouldRun !== 'boolean') failures.push('Missing independent change selection');
  let result;
  if (shouldRun === false) {
    result = { schemaVersion: 1, revision, scope: 'fresh-install-execution', status: 'not-applicable',
      reason: 'Independent change selection identifies only documentation or identical revisions', results: [], failures: [] };
  } else {
    for (const edition of ['community', 'enterprise']) {
      for (const format of ['vitest', 'playwright']) {
        const id = `${format}-${edition}`;
        requirements.push({ id, format, candidates: format === 'vitest'
          ? candidates.filter(file => isAdditionalWorkspaceTest(file, 'api-e2e'))
          : [...new Set([...criticalBrowserFiles, ...candidates.filter(file => file.startsWith('e2e-tests/tests/'))])] });
        try {
          const directory = format === 'vitest' ? path.join(input, `fresh-install-api-${edition}`)
            : path.dirname(browserArtifact(path.join(input, `fresh-install-playwright-${edition}`), 'evidence.json'));
          const bundle = readCandidateExecutionBundle({ id, format, directory, sourceRoot,
            outcome: jobResults?.['production-browser']?.result });
          if (format === 'playwright' && bundle.collected?.config?.metadata?.edition !== edition) {
            failures.push(`${id}: browser collection has a missing or different edition`);
          }
          if (format === 'playwright') {
            const verified = verifyBrowserProviderReadiness({ collected: bundle.collected, report: bundle.report,
              evidence: JSON.parse(readFileSync(path.join(directory, 'evidence.json'), 'utf8')),
              root: sourceRoot, revision, runId, runAttempt,
              artifactManifest: JSON.parse(readFileSync(browserArtifact(path.join(input, `fresh-install-playwright-${edition}`), 'browser-artifact-manifest.json'), 'utf8')),
              requirements: providerPolicy.editions?.[edition]?.requirements });
            providerReadiness.push({ edition, ...verified });
            if (verified.status !== 'passed') failures.push(...verified.failures.map(failure => `${id}: provider readiness: ${failure}`));
          }
          bundles.push(bundle);
        } catch (error) { failures.push(`${id}: ${error.message}`); }
      }
    }
    result = evaluateCandidateExecution({ root, revision, requirements, bundles });
    result.scope = 'fresh-install-execution';
    result.providerReadiness = providerReadiness;
  }
  result.failures.push(...failures);
  if (result.failures.length) result.status = 'failed';
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let result;
  try {
    const source = testRevision(root);
    if (source.dirty || source.revision !== process.env.GITHUB_SHA) throw new Error('Gate checkout is dirty or differs from candidate');
    const selection = selectIntegration(readChangedFiles({ cwd: root, base: process.env.TIER1_BASE_SHA, head: source.revision }));
    result = verifyFreshInstallExecution({ root, revision: source.revision,
      input: path.join(root, 'test-results/fresh-install-input'), candidates: repositoryTestFiles(root),
      shouldRun: selection.shouldRun, runId: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), jobResults: JSON.parse(process.env.FRESH_INSTALL_JOB_RESULTS || '{}') });
  } catch (error) { result = { schemaVersion: 1, scope: 'fresh-install-execution', status: 'failed', failures: [error.message] }; }
  const output = path.join(root, 'test-results/fresh-install-gate');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
  for (const failure of result.failures) console.error(failure);
  console.log(`Fresh-install execution: ${result.status}`);
  process.exitCode = ['passed', 'not-applicable'].includes(result.status) ? 0 : 1;
}
