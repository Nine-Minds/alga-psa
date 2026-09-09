import { createHash } from 'node:crypto';
import { playwrightTests, reconcilePlaywrightExecution } from './playwright-execution-evidence.mjs';
import { validateBrowserArtifactManifest } from './browser-artifact-manifest.mjs';

// Reporting projection of raw collection/execution. Never copy request bodies,
// error payloads or credentials from Playwright attachments into the scorecard.
export function browserTestMetrics({ collected, report, evidence, root, revision,
  artifactManifest, artifactManifestRequired = false, runId, runAttempt }) {
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
      providerObservations: providerObservations(result, { revision, cleanSource: cleanSource && revisionMatches, manifest: verifiedManifest }),
    }));
    return { identity: identity(entry), required, observed: Boolean(observed),
      outcome: observed?.status ?? 'missing',
      firstAttempt: attempts.find(attempt => attempt.retry === 0)?.status ?? 'missing',
      retryCount: attempts.filter(attempt => attempt.retry > 0).length, attempts };
  };
  const revisionMatches = typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)
    && evidence?.revision === revision;
  const cleanSource = evidence?.workingTreeDirty === false && ['before', 'after'].every(phase => {
    const source = evidence?.source?.[phase];
    return source?.revision === revision && source.dirty === false
      && Array.isArray(source.changes) && source.changes.length === 0;
  });
  let verifiedManifest = null;
  let artifactFailure = false;
  if (artifactManifest != null) {
    try {
      verifiedManifest = validateBrowserArtifactManifest(artifactManifest, {
        revision, edition: collected?.config?.metadata?.edition, runId, runAttempt,
      });
    } catch { artifactFailure = true; }
  } else if (artifactManifestRequired) artifactFailure = true;
  const journeys = expected.map(entry => project(entry, remaining.get(JSON.stringify(identity(entry)))?.shift(), true));
  for (const entries of remaining.values()) for (const entry of entries) journeys.push(project(entry, entry, false));
  const missing = journeys.some(journey => journey.required && (!journey.observed || journey.firstAttempt === 'missing'));
  return {
    schemaVersion: 2, suite: 'production-browser', revision: revision ?? null,
    status: !readable || !expected.length || missing || artifactFailure ? 'incomplete'
      : !revisionMatches || !cleanSource || evidence?.status !== 'passed' || verified.status !== 'passed' ? 'failed' : 'passed',
    configuration: {
      edition: collected?.config?.metadata?.edition ?? null,
      authentication: collected?.config?.metadata?.authentication ?? null,
      serverLifecycle: collected?.config?.metadata?.serverLifecycle ?? null,
    },
    // This identifies verified CI archives and loaded images, not a deployment.
    artifactManifest: verifiedManifest,
    collected: expected.length,
    executed: journeys.filter(journey => journey.observed && journey.attempts.some(attempt =>
      ['passed', 'failed', 'timedOut', 'interrupted'].includes(attempt.status))).length,
    counts: verified.counts, journeys,
    failures: [...verified.failures, ...(!revisionMatches ? ['Missing or mismatched candidate revision'] : []),
      ...(!cleanSource ? ['Missing, dirty or changed source evidence'] : []),
      ...(artifactFailure ? ['Missing or invalid CI test artifact identity'] : [])],
  };
}


// Only inline fixture attachments are eligible. Paths are never read, and the
// summary never copies URLs, operations, request paths, bodies or credentials.
// This reports observations, not independently required provider coverage.
function providerObservations(result, { revision, cleanSource, manifest }) {
  const unavailable = reason => ({ schemaVersion: 1, status: 'unavailable', reason, providers: [] });
  if (!cleanSource || !manifest) return unavailable('unverified-candidate-context');
  if (!Number.isInteger(result?.retry) || result.retry < 0) return unavailable('invalid-attempt');
  const attachments = Array.isArray(result.attachments) ? result.attachments.filter(a => a?.name === 'emulator-evidence') : [];
  if (!attachments.length) return unavailable('missing-observations');
  if (attachments.length !== 1) return unavailable('duplicate-observations');
  try {
    const attachment = attachments[0];
    if (attachment.contentType !== 'application/json' || typeof attachment.body !== 'string'
      || attachment.body.length > 2000000 || attachment.path != null
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.body)) throw new Error();
    const decoded = Buffer.from(attachment.body, 'base64');
    if (decoded.toString('base64') !== attachment.body) throw new Error();
    const data = JSON.parse(decoded.toString('utf8'));
    const allowed = ['msgraph', 'qbo', 'xero', 'stripe', 'smtp-sink'];
    if (!Array.isArray(data.providers) || !data.providers.length || new Set(data.providers).size !== data.providers.length
      || data.providers.some(p => !allowed.includes(p)) || !data.requests || typeof data.requests !== 'object'
      || Array.isArray(data.requests) || Object.keys(data.requests).length !== data.providers.length) throw new Error();
    const providers = [...data.providers].sort().map(provider => {
      const journal = data.requests[provider];
      const integer = n => Number.isSafeInteger(n) && n >= 0;
      if (!journal || typeof journal.supported !== 'boolean' || typeof journal.complete !== 'boolean'
        || !integer(journal.dropped) || !integer(journal.inFlight) || !integer(journal.generation)
        || !integer(journal.capacity) || journal.capacity < 1 || !Array.isArray(journal.requests)
        || journal.requests.length > journal.capacity
        || journal.complete !== (journal.supported && journal.dropped === 0 && journal.inFlight === 0)) throw new Error();
      const sequences = new Set();
      for (const request of journal.requests) {
        if (!integer(request?.sequence) || request.sequence < 1 || sequences.has(request.sequence)
          || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(request.method)
          || typeof request.path !== 'string' || !request.path.startsWith('/')
          || typeof request.aborted !== 'boolean' || request.aborted !== (request.status === null)
          || !(request.status === null || Number.isInteger(request.status) && request.status >= 100 && request.status <= 599)) throw new Error();
        sequences.add(request.sequence);
      }
      return { provider, mode: 'emulator', supported: journal.supported, complete: journal.complete,
        requestCount: journal.requests.length, dropped: journal.dropped, inFlight: journal.inFlight };
    });
    return { schemaVersion: 1, status: 'observed', revision, runId: manifest.runId,
      runAttempt: manifest.runAttempt, retry: result.retry,
      artifactContext: 'validated-browser-ci-archives',
      artifactManifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), providers,
      limitation: 'Fixture observations only; no required-provider completeness, isolation, OAuth, protocol parity or release readiness claim.' };
  } catch { return unavailable('malformed-observations'); }
}
