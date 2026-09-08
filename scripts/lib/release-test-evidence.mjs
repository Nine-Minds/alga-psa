import { verifyRuntimeObservationEvidence } from './runtime-observation-evidence.mjs';
import { createHash } from 'node:crypto';
import { validateReleaseManifest, compareReleaseDeployment } from './release-component-manifest.mjs';

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('Release identity must contain only JSON values');
}

// Bind all recorded metadata (including component build/source identities),
// not just server revision. Component ordering and JSON formatting are immaterial.
export function releaseManifestDigest(input) {
  const validation = validateReleaseManifest(input);
  if (validation.status !== 'passed') throw new Error(validation.failures.join('\n'));
  for (const component of input.manifest.components) {
    if (typeof component.revision !== 'string' || !/^[a-f0-9]{40}$/.test(component.revision)) {
      throw new Error(`Component ${component.name} requires an explicit source revision`);
    }
    const build = component.build;
    const runId = build?.runId;
    const validRunId = typeof runId === 'string' ? Boolean(runId.trim()) && runId.trim() === runId
      : Number.isSafeInteger(runId) && runId > 0;
    if (!build || typeof build.provider !== 'string' || !build.provider.trim() || build.provider.trim() !== build.provider || !validRunId) {
      throw new Error(`Component ${component.name} requires a build identity (provider and runId)`);
    }
    if (build.attempt !== undefined && (!Number.isSafeInteger(build.attempt) || build.attempt <= 0)) {
      throw new Error(`Component ${component.name} has an invalid build attempt`);
    }
  }
  const normalized = { ...input.manifest, components: [...input.manifest.components].sort((a, b) => a.name.localeCompare(b.name)) };
  return `sha256:${createHash('sha256').update(canonical(normalized)).digest('hex')}`;
}

// Required check identities are supplied by the consuming release policy,
// independently of submitted evidence. The producer must bind every verdict
// when testing the actual running component set; this does not attest provenance.
export function verifyReleaseTestEvidence({ manifest, revision, edition, requiredComponents, requiredChecks, evidence }) {
  const input = { manifest, revision, edition, requiredComponents };
  const failures = [...validateReleaseManifest(input).failures];
  let manifestDigest;
  try { manifestDigest = releaseManifestDigest(input); } catch (error) { failures.push(error.message); }
  if (!Array.isArray(requiredChecks) || !requiredChecks.length || requiredChecks.some(id => typeof id !== 'string' || !id.trim())
    || new Set(requiredChecks).size !== requiredChecks.length) failures.push('Missing, empty or duplicate required release checks');
  const checks = Array.isArray(requiredChecks) ? requiredChecks : [];
  if (evidence?.schemaVersion !== 1 || evidence?.revision !== revision || evidence?.edition !== edition) failures.push('Unsupported or stale release test evidence');
  if (!manifestDigest || evidence?.manifestDigest !== manifestDigest) failures.push('Tests belong to a different release manifest');
  if (!Array.isArray(evidence?.results) || !evidence.results.length) failures.push('Missing release test results');
  const seen = new Set();
  for (const result of Array.isArray(evidence?.results) ? evidence.results : []) {
    if (!checks.includes(result?.id) || seen.has(result?.id)) failures.push(`Unexpected or duplicate release check: ${result?.id}`);
    seen.add(result?.id);
    if (result?.manifestDigest !== manifestDigest) failures.push(`${result?.id}: check belongs to a different manifest`);
    if (result?.status !== 'passed' || !Array.isArray(result?.failures) || result.failures.length) failures.push(`${result?.id}: incomplete release check`);
  }
  for (const id of checks) if (!seen.has(id)) failures.push(`Missing required release check: ${id}`);
  return { schemaVersion: 1, scope: 'tested-release-manifest', revision, edition, manifestDigest,
    status: failures.length ? 'failed' : 'passed', failures };
}

export function verifyReleasePromotion(input) {
  const tests = verifyReleaseTestEvidence(input);
  const freshness = verifyRuntimeObservationEvidence(input);
  const deployment = compareReleaseDeployment({ ...input, observations: input.runtimeEvidence?.observations });
  const failures = [...tests.failures, ...freshness.failures, ...deployment.failures];
  return { ...tests, scope: 'release-promotion-identities', status: failures.length ? 'failed' : 'passed', failures };
}
