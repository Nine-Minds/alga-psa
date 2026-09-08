import { selectIntegration } from './integration-selection.mjs';
import { workspaceRequirements } from './workspace-execution-gate.mjs';

export const readinessRequirements = [
  { job: 'inventory', artifact: 'repository-inventory', scope: 'repository-inventory', conditional: true, collectionOnly: true },
  { job: 'unit', artifact: 'server-unit-aggregate', scope: 'server-unit-execution', members: ['server-unit'] },
  { job: 'node', artifact: 'node-workflow-gate', scope: 'node-workflow', members: ['node-tooling', 'appliance', 'browser-discovery'], revisionSuffix: true },
  { job: 'workspace', artifact: 'workspace-execution-gate', scope: 'additional-workspace-tests', members: workspaceRequirements.map(({ suite }) => suite) },
  { job: 'integration', artifact: 'integration-execution-gate', suite: 'integration', conditional: true },
  { job: 'integration', artifact: 'infrastructure-execution-evidence', suite: 'infrastructure', conditional: true },
  { job: 'integration', artifact: 'workspace-db-aggregate', scope: 'workspace-db-execution', members: ['workspace-db'], conditional: true },
  { job: 'browser', artifact: 'fresh-install-execution-gate', scope: 'fresh-install-execution',
    members: ['vitest-community', 'playwright-community', 'vitest-enterprise', 'playwright-enterprise'], conditional: true },
  { job: 'browser', artifact: 'supported-upgrade-execution', scope: 'supported-upgrade', members: ['upgrade-schema', 'upgrade-browser'], conditional: true },
  { job: 'browser', artifact: 'supported-citus-upgrade-execution', scope: 'supported-upgrade', members: ['upgrade-schema', 'upgrade-browser'], conditional: true },
  { job: 'browser', artifact: 'teams-development-execution', suite: 'teams-development-browser', conditional: true },
  { job: 'temporal', conditionalWorkflow: true, artifact: 'temporal-execution-gate', scope: 'temporal-tests', members: ['temporal-readiness', 'temporal-engine'] },
  { job: 'citus', conditionalWorkflow: true, artifact: 'citus-aggregate', scope: 'citus-execution', members: ['citus-runtime', 'temporal-database'] },
];

// Consumes the independently verified per-workflow verdicts, downloaded from
// this parent run. It cannot replace those raw-report verifiers or protections.
export function evaluateProductionReadiness({ revision, changed, jobs, artifacts }) {
  const failures = [], results = [];
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) failures.push('Invalid candidate revision');
  const selection = selectIntegration(changed);
  if (jobs?.selection?.result !== 'success') failures.push('Readiness selection did not succeed');
  for (const requirement of readinessRequirements) {
    const problems = [];
    const verdict = artifacts?.[requirement.artifact];
    if (requirement.conditionalWorkflow && !selection.shouldRun && jobs?.[requirement.job]?.result === 'skipped') {
      results.push({ id: requirement.artifact, status: 'not-applicable', reason: selection.reason, failures: [] });
      continue;
    }
    if (jobs?.[requirement.job]?.result !== 'success') problems.push(`Required workflow: ${jobs?.[requirement.job]?.result ?? 'missing'}`);
    if (!verdict || verdict.schemaVersion !== 1 || verdict.revision !== revision) problems.push('Missing, unsupported or stale verdict');
    if (requirement.scope ? verdict?.scope !== requirement.scope : verdict?.suite !== requirement.suite) problems.push('Wrong verdict scope');
    if (!Array.isArray(verdict?.failures) || verdict.failures.length) problems.push('Failed or malformed verdict');
    const notApplicable = verdict?.status === 'not-applicable';
    if (notApplicable) {
      if (!requirement.conditional || selection.shouldRun || typeof verdict.reason !== 'string' || !verdict.reason.trim()) problems.push('Unjustified not-applicable selection');
    } else if (requirement.collectionOnly) {
      if (verdict?.status !== 'passed' || verdict.executionVerified !== false
        || !Array.isArray(verdict.candidates) || !verdict.candidates.length
        || !Array.isArray(verdict.unmatched) || verdict.unmatched.length
        || !Array.isArray(verdict.runners) || !verdict.runners.length) {
        problems.push('Missing or incomplete repository collection');
      }
    } else {
      if (verdict?.status !== 'passed') problems.push(`Incomplete verdict: ${verdict?.status ?? 'missing'}`);
      const members = requirement.members ? verdict?.results ?? verdict?.suites : [verdict];
      if (!Array.isArray(members) || !members.length) problems.push('Empty mandatory execution');
      else {
        if (requirement.members) {
          const identities = members.map(member => member?.id ?? member?.suite);
          if (identities.length !== requirement.members.length || new Set(identities).size !== identities.length || requirement.members.some(id => !identities.includes(id))) problems.push('Missing, duplicate or unexpected required member');
        }
        for (const member of members) {
          const id = member?.id ?? member?.suite ?? requirement.artifact;
          if (member?.status !== 'passed' || !Array.isArray(member?.failures) || member.failures.length) problems.push(`${id}: failed or malformed member`);
          if (requirement.job === 'node' && id === 'browser-discovery') {
            if (member.executionVerified !== false) problems.push('Browser discovery must not claim execution');
            continue;
          }
          const counts = member?.counts;
          if (!counts || !Number.isSafeInteger(counts.passed) || counts.passed <= 0 || !Number.isSafeInteger(counts.failed) || counts.failed !== 0) problems.push(`${id}: empty or failed execution counts`);
          if (counts && Object.entries(counts).some(([key, value]) => !Number.isSafeInteger(value) || value < 0 || (!['tests', 'passed'].includes(key) && value !== 0))) problems.push(`${id}: skipped or incomplete execution`);
        }
      }
    }
    results.push({ id: requirement.artifact, status: problems.length ? 'failed' : notApplicable ? 'not-applicable' : 'passed', reason: notApplicable ? verdict.reason : undefined, failures: problems });
    failures.push(...problems.map(problem => `${requirement.artifact}: ${problem}`));
  }
  return { schemaVersion: 1, revision, scope: 'production-regression-readiness', status: failures.length ? 'failed' : 'passed', selection, results, failures };
}
