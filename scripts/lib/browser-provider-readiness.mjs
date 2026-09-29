import { browserTestMetrics } from './browser-test-metrics.mjs';

const providers = new Set(['msgraph', 'qbo', 'xero', 'stripe', 'smtp-sink']);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const identityValid = value => Array.isArray(value) && value.length === 4
  && value.slice(0, 3).every(nonempty) && Array.isArray(value[3])
  && value[3].length > 0 && value[3].every(nonempty);

// Expectations belong to the consumer. Raw reports are projected again; an
// attached or previously computed passed verdict cannot supply its own policy.
export function verifyBrowserProviderReadiness({ requirements, ...input } = {}) {
  const failures = [], observations = [];
  const seen = new Set();
  if (!Array.isArray(requirements) || !requirements.length) failures.push('invalid-provider-requirements');
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const key = JSON.stringify(requirement?.identity);
    if (!identityValid(requirement?.identity) || seen.has(key)) failures.push('invalid-or-duplicate-journey-requirement');
    seen.add(key);
    const expected = requirement?.providers;
    if (!Array.isArray(expected) || !expected.length
      || expected.some(p => !providers.has(p?.provider) || p.mode !== 'emulator')
      || new Set(expected.map(p => p?.provider)).size !== expected.length) failures.push('invalid-or-duplicate-provider-requirement');
  }
  let metrics;
  try { metrics = browserTestMetrics({ ...input, artifactManifestRequired: true }); }
  catch { failures.push('unreadable-browser-execution'); }
  if (metrics?.status !== 'passed') failures.push('browser-execution-not-passed');
  if (!failures.length) {
    for (const journey of metrics.journeys) {
      const expected = requirements.find(r => JSON.stringify(r.identity) === JSON.stringify(journey.identity));
      for (const attempt of journey.attempts) {
        for (const observed of attempt.providerObservations?.providers ?? []) {
          if (observed.requestCount > 0 && !expected?.providers.some(p => p.provider === observed.provider && p.mode === observed.mode))
            failures.push('unexpected-observed-provider-journey');
        }
      }
    }
    for (const [index, requirement] of requirements.entries()) {
      const matches = metrics.journeys.filter(j => JSON.stringify(j.identity) === JSON.stringify(requirement.identity));
      const journey = matches[0];
      if (matches.length !== 1 || !journey.required || !journey.observed || journey.firstAttempt !== 'passed'
        || journey.retryCount !== 0 || journey.attempts.length !== 1 || journey.attempts[0].retry !== 0) {
        failures.push(`journey-${index}:missing-duplicate-or-retried`);
        continue;
      }
      const observation = journey.attempts[0].providerObservations;
      if (observation?.status !== 'observed') {
        failures.push(`journey-${index}:provider-observations-unavailable`);
        continue;
      }
      for (const expected of requirement.providers) {
        const found = observation.providers.filter(p => p.provider === expected.provider && p.mode === expected.mode);
        if (found.length !== 1 || !found[0].supported || !found[0].complete || found[0].requestCount <= 0)
          failures.push(`journey-${index}:${expected.provider}:missing-incomplete-or-empty`);
      }
      observations.push({ identity: requirement.identity, ...observation });
    }
  }
  return { schemaVersion: 1, scope: 'browser-provider-readiness', revision: input.revision ?? null,
    status: failures.length ? 'failed' : 'passed', failures,
    configuration: metrics?.configuration ?? null, observations,
    limitation: 'Candidate CI archive-backed provider observations only; no OAuth, protocol parity, live-provider or deployment verification claim.' };
}
