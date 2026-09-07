import { playwrightTests, reconcilePlaywrightExecution } from './playwright-execution-evidence.mjs';

// Reporting projection of raw collection/execution. Never copy request bodies,
// error payloads or credentials from Playwright attachments into the scorecard.
export function browserTestMetrics({ collected, report, evidence, root, revision }) {
  const verified = reconcilePlaywrightExecution({ collected, report, root, revision,
    exitCode: evidence?.status === 'passed' ? 0 : 1 });
  let expected = [], actual = [], readable = true;
  try { expected = playwrightTests(collected, root); } catch { readable = false; }
  try { actual = playwrightTests(report, root); } catch { readable = false; }
  const identity = entry => [entry.file, entry.projectId, entry.projectName, entry.titles];
  const remaining = new Map();
  for (const entry of actual) {
    const key = JSON.stringify(identity(entry));
    remaining.set(key, [...(remaining.get(key) ?? []), entry]);
  }
  const project = (entry, observed, required) => {
    const attempts = (Array.isArray(observed?.results) ? observed.results : []).map(result => ({
      retry: result.retry, status: result.status,
      durationMs: typeof result.duration === 'number' ? result.duration : null,
    }));
    return { identity: identity(entry), required, observed: Boolean(observed),
      outcome: observed?.status ?? 'missing',
      firstAttempt: attempts.find(attempt => attempt.retry === 0)?.status ?? 'missing',
      retryCount: attempts.filter(attempt => attempt.retry > 0).length, attempts };
  };
  const journeys = expected.map(entry => project(entry, remaining.get(JSON.stringify(identity(entry)))?.shift(), true));
  for (const entries of remaining.values()) for (const entry of entries) journeys.push(project(entry, entry, false));
  const missing = journeys.some(journey => journey.required && (!journey.observed || journey.firstAttempt === 'missing'));
  const revisionMatches = typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)
    && evidence?.revision === revision;
  return {
    schemaVersion: 2, suite: 'production-browser', revision: revision ?? null,
    status: !readable || !expected.length || missing ? 'incomplete'
      : !revisionMatches || evidence?.status !== 'passed' || verified.status !== 'passed' ? 'failed' : 'passed',
    configuration: {
      edition: collected?.config?.metadata?.edition ?? null,
      authentication: collected?.config?.metadata?.authentication ?? null,
      serverLifecycle: collected?.config?.metadata?.serverLifecycle ?? null,
    },
    // The deployment pipeline must supply a verified immutable component set.
    // A source SHA or local image tag is not an artifact manifest.
    artifactManifest: null,
    collected: expected.length,
    executed: journeys.filter(journey => journey.observed && journey.attempts.some(attempt =>
      ['passed', 'failed', 'timedOut', 'interrupted'].includes(attempt.status))).length,
    counts: verified.counts, journeys,
    failures: [...verified.failures, ...(!revisionMatches ? ['Missing or mismatched candidate revision'] : [])],
  };
}
