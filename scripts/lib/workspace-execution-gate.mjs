import { compareExecutionEvidence, reconcileExecution } from './test-execution-evidence.mjs';
import { reconcileDiscovery } from './test-discovery.mjs';
import { reconcileTestShards } from './test-sharding.mjs';

export const workspaceRequirements = [
  { suite: 'workspace-unit', job: 'workspace-tests', shards: 1 },
  { suite: 'workspace-runtime', job: 'workspace-tests', shards: 1 },
  { suite: 'server-colocated', job: 'workspace-tests', shards: 1 },
  { suite: 'nx-tooling', job: 'workspace-tests', shards: 1 },
  { suite: 'ui-kit-showcase', job: 'workspace-tests', shards: 1 },
  { suite: 'enterprise-integration', job: 'enterprise-integration', shards: 1 },
  { suite: 'ai-gateway', job: 'ai-gateway', shards: 1 },
  { suite: 'enterprise-unit', job: 'enterprise-unit', shards: 3 },
];

// Evaluate reports, not just producer-authored "passed" manifests. The caller
// supplies the expected revision and tracked candidate files independently.
export function evaluateWorkspaceGate({ root, revision, jobResults, candidatesBySuite, bundles }) {
  const failures = [];
  const suites = [];
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) failures.push('Missing or invalid candidate revision');
  for (const job of new Set([...workspaceRequirements.map(item => item.job), 'enterprise-unit-complete'])) {
    if (jobResults?.[job]?.result !== 'success') failures.push(`Required job ${job}: ${jobResults?.[job]?.result ?? 'missing'}`);
  }
  if (!Array.isArray(bundles)) {
    failures.push('Missing execution bundles');
    bundles = [];
  }
  for (const bundle of bundles) {
    if (!workspaceRequirements.some(item => item.suite === bundle?.suite)) failures.push(`Unexpected suite bundle: ${bundle?.suite}`);
  }
  for (const requirement of workspaceRequirements) {
    const { suite, shards: total } = requirement;
    const selected = bundles.filter(bundle => bundle?.suite === suite);
    const evidence = [];
    const suiteFailures = [];
    for (const [index, bundle] of selected.entries()) {
      const label = `${suite} bundle ${index + 1}`;
      try {
        const manifest = bundle.evidence;
        if (manifest?.schemaVersion !== 1) throw new Error('Missing or unsupported evidence schema');
        for (const phase of ['before', 'after']) {
          const source = manifest.source?.[phase];
          if (source?.revision !== revision || source.dirty !== false || !Array.isArray(source.changes) || source.changes.length) {
            suiteFailures.push(`${label}: source ${phase} is missing, dirty or from a different revision`);
          }
        }
        if (manifest.workingTreeDirty !== false) suiteFailures.push(`${label}: missing or dirty working-tree status`);
        if (!Array.isArray(manifest.selection?.filters) || manifest.selection.filters.length) suiteFailures.push(`${label}: filtered execution cannot satisfy the full gate`);
        const verified = reconcileExecution({ root, suite, revision, collected: bundle.collected,
          collectedTests: bundle.collectedTests, report: bundle.report,
          exitCode: manifest.status === 'passed' ? 0 : 1 });
        if (!Array.isArray(bundle.collectedTests) || !bundle.collectedTests.length) suiteFailures.push(`${label}: missing assertion collection`);
        suiteFailures.push(...verified.failures.map(failure => `${label}: ${failure}`));
        suiteFailures.push(...compareExecutionEvidence(manifest, verified, label));
        evidence.push(manifest);
      } catch (error) { suiteFailures.push(`${label}: ${error.message}`); }
    }
    // Job outcomes are checked above. Keep each suite's report result distinct
    // from its matrix's combined outcome so one failed sibling is not reported
    // as five different test failures.
    const aggregate = reconcileTestShards({ shards: evidence, suite, revision, mode: 'full', total });
    suiteFailures.push(...aggregate.failures);
    try {
      const discovery = reconcileDiscovery({ root, candidates: candidatesBySuite?.[suite] ?? [],
        collections: [{ runner: suite, status: 'passed', files: aggregate.executedFiles }] });
      suiteFailures.push(...discovery.failures);
    } catch (error) { suiteFailures.push(`Cannot reconcile required inventory: ${error.message}`); }
    suites.push({ suite, status: suiteFailures.length ? 'failed' : 'passed', counts: aggregate.counts,
      expectedFiles: candidatesBySuite?.[suite] ?? [], executedFiles: aggregate.executedFiles,
      failures: suiteFailures });
    failures.push(...suiteFailures.map(failure => `${suite}: ${failure}`));
  }
  return { schemaVersion: 1, revision, scope: 'additional-workspace-tests',
    status: failures.length ? 'failed' : 'passed', suites, failures };
}
