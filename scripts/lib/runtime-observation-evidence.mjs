function targetIdentity(target) {
  if (typeof target?.context !== 'string' || !target.context.trim() || typeof target?.namespace !== 'string' || !target.namespace.trim()
    || !Array.isArray(target.workloads) || !target.workloads.length) throw new Error('Explicit runtime target is required');
  const workloads = target.workloads.map(workload => {
    if (typeof workload?.kind !== 'string' || !workload.kind.trim() || typeof workload?.name !== 'string' || !workload.name.trim()) throw new Error('Invalid runtime workload target');
    return JSON.stringify([workload.kind, workload.name]);
  }).sort();
  if (new Set(workloads).size !== workloads.length) throw new Error('Duplicate runtime workload target');
  return JSON.stringify([target.context, target.namespace, workloads]);
}

export function verifyRuntimeObservationEvidence({ runtimeEvidence, expectedTarget, maxObservationAgeSeconds, now = Date.now() }) {
  const failures = [];
  if (runtimeEvidence?.schemaVersion !== 1 || runtimeEvidence?.scope !== 'kubernetes-runtime-image-observations') failures.push('Missing or unsupported runtime observation envelope');
  try {
    if (targetIdentity(expectedTarget) !== targetIdentity(runtimeEvidence?.target)) failures.push('Runtime observations belong to a different target');
  } catch (error) { failures.push(error.message); }
  if (!Number.isSafeInteger(maxObservationAgeSeconds) || maxObservationAgeSeconds <= 0) failures.push('A positive maximum observation age is required');
  const observedAt = typeof runtimeEvidence?.observedAt === 'string' ? Date.parse(runtimeEvidence.observedAt) : NaN;
  const ageMs = now - observedAt;
  if (!Number.isFinite(now) || !Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== runtimeEvidence.observedAt) failures.push('Invalid runtime observation timestamp');
  else if (ageMs < 0 || ageMs > maxObservationAgeSeconds * 1000) failures.push('Runtime observations are future-dated or stale');
  if (!Array.isArray(runtimeEvidence?.observations) || !runtimeEvidence.observations.length) failures.push('Missing runtime component observations');
  return { schemaVersion: 1, scope: 'runtime-observation-freshness', status: failures.length ? 'failed' : 'passed',
    ageMs: Number.isFinite(ageMs) ? ageMs : null, failures };
}
