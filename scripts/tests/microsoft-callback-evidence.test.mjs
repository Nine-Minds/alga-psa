import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMicrosoftCallbackEvidence } from '../lib/microsoft-callback-evidence.mjs';
function fixture() {
  const revision = 'a'.repeat(40);
  return { revision, source: { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } },
    report: { schemaVersion: 1, scope: 'microsoft-nextauth-callback-development', releaseValidation: false,
      status: 'passed', stage: 'completed', sourceRevision: revision, sourceRevisionOrigin: 'git', sourceRevisionAfter: revision,
      fixtureCleanup: 'removed', processCleanup: 'stopped',
      configuration: { edition: 'enterprise', serverLifecycle: 'next-development', provider: 'microsoft', authority: 'synthetic-loopback', applicationAuthentication: 'nextauth' },
      execution: { status: 'passed', accepted: { stateAccepted: true, nonceRequested: false },
        rejected: { stateAccepted: false, nonceRequested: false }, tokenRequests: 1, jwksRequests: 0,
        limitations: ['Synthetic fixture only'] } } };
}
test('accepts actual callback observations with clean trusted source without inferring unobserved checks', () => {
  const result = verifyMicrosoftCallbackEvidence(fixture());
  assert.equal(result.status, 'passed'); assert.equal(result.releaseValidation, false);
  assert.equal(Object.hasOwn(result, 'signatureVerified'), false);
  assert.equal(Object.hasOwn(result, 'nonceValidated'), false);
});
for (const [name, mutate] of [
  ['missing report', x => { delete x.report; }], ['missing source', x => { delete x.source; }],
  ['wrong revision', x => { x.revision = 'b'.repeat(40); }], ['invalid revision', x => { x.revision = 'secret'; }],
  ['dirty before', x => { x.source.before.dirty = true; }], ['changed checkout', x => { x.source.after.changes = [{}]; }],
  ['different after', x => { x.source.after.revision = 'b'.repeat(40); }],
  ['environment source', x => { x.report.sourceRevisionOrigin = 'environment'; }],
  ['callback source changed', x => { x.report.sourceRevisionAfter = 'b'.repeat(40); }],
  ['release claim', x => { x.report.releaseValidation = true; }], ['wrong scope', x => { x.report.scope = 'production'; }],
  ['failed', x => { x.report.status = 'failed'; }], ['unfinished', x => { x.report.stage = 'callback'; }],
  ['fixture retained', x => { x.report.fixtureCleanup = 'failed-retained'; }], ['process live', x => { x.report.processCleanup = 'pending'; }],
  ['missing config', x => { delete x.report.configuration; }], ['wrong provider', x => { x.report.configuration.provider = 'google'; }],
  ['signature claim', x => { x.report.execution.signatureVerified = true; }], ['nonce claim', x => { x.report.execution.accepted.nonceValidated = true; }],
  ['extra auth config', x => { x.report.configuration.realMicrosoft = true; }],
  ['state not rejected', x => { x.report.execution.rejected.stateAccepted = true; }],
  ['state not accepted', x => { x.report.execution.accepted.stateAccepted = false; }],
  ['no token exchange', x => { x.report.execution.tokenRequests = 0; }], ['extra token exchange', x => { x.report.execution.tokenRequests = 2; }],
  ['invalid JWKS', x => { x.report.execution.jwksRequests = -1; }], ['nonce not boolean', x => { x.report.execution.accepted.nonceRequested = 'false'; }],
]) test(`rejects ${name}`, () => {
  const input = fixture(); mutate(input);
  const result = verifyMicrosoftCallbackEvidence(input);
  assert.equal(result.status, 'failed'); assert.ok(result.failures.length > 0);
});
test('sanitized verdict never echoes arbitrary report strings or errors', () => {
  const input = fixture(); input.report.error = 'secret-value'; input.report.execution.limitations.push('private-value');
  const encoded = JSON.stringify(verifyMicrosoftCallbackEvidence(input));
  assert.ok(!encoded.includes('secret-value')); assert.ok(!encoded.includes('private-value'));
});
test('positive nonce/JWKS observation counts remain observations rather than authentication claims', () => {
  const input = fixture(); input.report.execution.accepted.nonceRequested = true; input.report.execution.jwksRequests = 1;
  assert.equal(verifyMicrosoftCallbackEvidence(input).status, 'passed');
});

function containerFixture() {
  const input = fixture();
  input.report.sourceRevisionOrigin = 'environment';
  input.report.sourceRevisionAfter = null;
  input.runtimeBinding = { imageRevision: input.revision, imageId: `sha256:${'1'.repeat(64)}`,
    containerImageId: `sha256:${'1'.repeat(64)}`, mountedSourceRevision: input.revision, mountsReadOnly: true };
  return input;
}
test('accepts no-git container only with matching image/source read-only binding and clean wrapper', () => {
  const result = verifyMicrosoftCallbackEvidence(containerFixture());
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.counts, { tests: 2, passed: 2, failed: 0 });
});
for (const [name, mutate] of [
  ['missing runtime binding', x => { delete x.runtimeBinding; }],
  ['wrong image revision', x => { x.runtimeBinding.imageRevision = 'b'.repeat(40); }],
  ['invalid image ID', x => { x.runtimeBinding.imageId = 'latest'; x.runtimeBinding.containerImageId = 'latest'; }],
  ['different container image', x => { x.runtimeBinding.containerImageId = `sha256:${'2'.repeat(64)}`; }],
  ['wrong mounted source', x => { x.runtimeBinding.mountedSourceRevision = 'b'.repeat(40); }],
  ['writable mounts', x => { x.runtimeBinding.mountsReadOnly = false; }],
  ['dirty wrapper', x => { x.source.before.dirty = true; }],
  ['unexpected source after', x => { x.report.sourceRevisionAfter = 'b'.repeat(40); }],
]) test(`container evidence rejects ${name}`, () => {
  const input = containerFixture(); mutate(input);
  const result = verifyMicrosoftCallbackEvidence(input);
  assert.equal(result.status, 'failed');
  assert.equal(Object.hasOwn(result, 'counts'), false);
});
