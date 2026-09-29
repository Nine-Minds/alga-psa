const configuration = {
  edition: 'enterprise', serverLifecycle: 'next-development', provider: 'microsoft',
  authority: 'synthetic-loopback', applicationAuthentication: 'nextauth',
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));

// Independent consumer of the sanitized report. A successful synthetic callback
// is development auth behavior, never live-provider or signature verification.
export function verifyMicrosoftCallbackEvidence({ report, revision, source, runtimeBinding } = {}) {
  const failures = [];
  const require = (condition, code) => { if (!condition) failures.push(code); };
  require(typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision), 'invalid-expected-revision');
  require(['before', 'after'].every(phase => {
    const snapshot = source?.[phase];
    return snapshot?.revision === revision && snapshot.dirty === false
      && Array.isArray(snapshot.changes) && snapshot.changes.length === 0;
  }), 'unverified-wrapper-source');
  require(exactKeys(report, ['schemaVersion', 'scope', 'status', 'releaseValidation', 'stage', 'sourceRevision',
    'sourceRevisionOrigin', 'sourceRevisionAfter', 'fixtureCleanup', 'processCleanup', 'configuration', 'execution']), 'unknown-or-invalid-report-fields');
  require(report?.schemaVersion === 1 && report.scope === 'microsoft-nextauth-callback-development'
    && report.releaseValidation === false, 'invalid-development-scope');
  require(report?.status === 'passed' && report.stage === 'completed', 'callback-not-completed');
  const gitSource = report?.sourceRevisionOrigin === 'git' && report.sourceRevision === revision
    && report.sourceRevisionAfter === revision;
  const containerSource = report?.sourceRevisionOrigin === 'environment' && report.sourceRevision === revision
    && report.sourceRevisionAfter === null && runtimeBinding?.imageRevision === revision
    && /^sha256:[a-f0-9]{64}$/.test(runtimeBinding.imageId ?? '')
    && runtimeBinding.containerImageId === runtimeBinding.imageId
    && runtimeBinding.mountedSourceRevision === revision && runtimeBinding.mountsReadOnly === true;
  require(gitSource || containerSource, 'mismatched-callback-source');
  require(exactKeys(report?.configuration, Object.keys(configuration))
    && Object.entries(configuration).every(([key, value]) => report.configuration[key] === value), 'invalid-callback-configuration');
  require(report?.fixtureCleanup === 'removed' && report.processCleanup === 'stopped', 'callback-cleanup-incomplete');
  const execution = report?.execution;
  require(exactKeys(execution, ['status', 'accepted', 'rejected', 'tokenRequests', 'jwksRequests', 'limitations']), 'unknown-or-invalid-execution-fields');
  require(execution?.status === 'passed' && execution.tokenRequests === 1, 'invalid-callback-execution');
  require(Number.isSafeInteger(execution?.jwksRequests) && execution.jwksRequests >= 0, 'invalid-jwks-observation');
  for (const [name, stateAccepted] of [['accepted', true], ['rejected', false]]) {
    const observation = execution?.[name];
    require(exactKeys(observation, ['stateAccepted', 'nonceRequested'])
      && observation.stateAccepted === stateAccepted && typeof observation.nonceRequested === 'boolean', `invalid-${name}-state-observation`);
  }
  if (execution && Object.hasOwn(execution, 'limitations')) {
    require(Array.isArray(execution.limitations) && execution.limitations.every(value => typeof value === 'string'), 'invalid-limitations-format');
  }
  return { schemaVersion: 1, scope: 'microsoft-callback-development-evidence', releaseValidation: false,
    revision: /^[a-f0-9]{40}$/.test(revision ?? '') ? revision : null,
    status: failures.length ? 'failed' : 'passed', failures,
    ...(failures.length ? {} : { counts: { tests: 2, passed: 2, failed: 0 } }),
    limitation: 'Synthetic development callback only; no live Microsoft consent, signature verification, nonce validation or release validation claim.' };
}
