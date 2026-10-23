import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DNS_PENDING_MAX_AGE_MS,
  evaluateDnsAdmission,
  ensureRequestedDnsActive
} from '../setup-admission.mjs';

const REQUESTED = '2026-09-22T12:00:00.000Z';
const REQUESTED_FINGERPRINT = 'c'.repeat(64);

function activeAt(submittedAt, configFingerprint = REQUESTED_FINGERPRINT) {
  return {
    state: 'active',
    ok: true,
    submittedAt,
    at: submittedAt,
    activation: { fingerprint: 'a'.repeat(64), configFingerprint, stage: 'active' }
  };
}

test('a missing or malformed result never authorizes setup', () => {
  for (const result of [null, undefined, 'nope', 42]) {
    const decision = evaluateDnsAdmission({ requestedAt: REQUESTED, requestedFingerprint: REQUESTED_FINGERPRINT, result });
    assert.equal(decision.ok, false);
    assert.equal(decision.pending, true);
  }
});

test('a failed reconcile blocks with its own error', () => {
  const decision = evaluateDnsAdmission({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    result: { state: 'failed', ok: false, error: 'One or more workload rollouts did not become ready.' }
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, false);
  assert.match(decision.error, /rollouts/);
});

test('a fresh active activation for the current request is admitted', () => {
  const decision = evaluateDnsAdmission({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    result: activeAt('2026-09-22T12:00:05.000Z')
  });
  assert.deepEqual(decision, { ok: true, pending: false, error: null });
});

test('a stale success is never admitted for a changed configuration', () => {
  const decision = evaluateDnsAdmission({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    result: activeAt('2026-09-22T11:00:00.000Z')
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, true);
  assert.match(decision.error, /predates/);
});

test('an active activation for a different resolver configuration is held', () => {
  // The completion is fresher than the request, so a timestamp-only comparison
  // would admit it — but it belongs to the configuration the operator replaced.
  const decision = evaluateDnsAdmission({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    result: activeAt('2026-09-22T12:30:00.000Z', 'd'.repeat(64))
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, true);
  assert.match(decision.error, /different resolver configuration/);
});

test('an active activation with no recorded fingerprint is held', () => {
  const result = activeAt('2026-09-22T12:00:05.000Z');
  delete result.activation.configFingerprint;
  const decision = evaluateDnsAdmission({ requestedAt: REQUESTED, requestedFingerprint: REQUESTED_FINGERPRINT, result });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, true);
  assert.match(decision.error, /different resolver configuration/);
});

test('an ancient pending record is not authorized by the staleness timeout', () => {
  const requested = Date.parse(REQUESTED);
  const decision = evaluateDnsAdmission({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    result: {
      state: 'submitted',
      ok: null,
      submittedAt: new Date(requested - DNS_PENDING_MAX_AGE_MS - 60_000).toISOString()
    }
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, true);
});

test('active with unparseable timestamps is not admitted', () => {
  const decision = evaluateDnsAdmission({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    result: activeAt(null)
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, true);
});

test('ensureRequestedDnsActive admits a fresh active reconcile', async () => {
  const decision = await ensureRequestedDnsActive({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => activeAt('2026-09-22T12:00:05.000Z'),
    readResult: () => activeAt('2026-09-22T12:00:05.000Z')
  });
  assert.equal(decision.ok, true);
});

test('custom-to-system resubmission requires a reconcile that post-dates the new request', async () => {
  // The system-mode request was stamped after the old custom activation, so the
  // stored success is stale and must not be reused.
  const requested = '2026-09-22T12:30:00.000Z';
  const stale = activeAt('2026-09-22T12:00:00.000Z');
  const held = await ensureRequestedDnsActive({
    requestedAt: requested,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => stale,
    readResult: () => stale
  });
  assert.equal(held.ok, false);
  assert.match(held.error, /predates/);

  const fresh = activeAt('2026-09-22T12:30:01.000Z');
  const admitted = await ensureRequestedDnsActive({
    requestedAt: requested,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => fresh,
    readResult: () => fresh
  });
  assert.equal(admitted.ok, true);
});

test('a completed activation for the previous fingerprint never authorizes the current inputs', async () => {
  // Regression: after a control-plane restart, an older host activation for a
  // different resolver configuration finishes later than the new inputs were
  // submitted. Time alone would admit it; the fingerprint must hold it.
  const completion = activeAt('2026-09-22T12:45:00.000Z', 'd'.repeat(64));
  const decision = await ensureRequestedDnsActive({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => completion,
    readResult: () => completion
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, true);
  assert.match(decision.error, /different resolver configuration/);
});

test('a skipped or concurrent reconcile never authorizes setup', async () => {
  for (const skipped of ['running', 'setup-in-progress', 'script-missing', 'disabled']) {
    const decision = await ensureRequestedDnsActive({
      requestedAt: REQUESTED,
      requestedFingerprint: REQUESTED_FINGERPRINT,
      reconcileOnce: async () => ({ skipped }),
      readResult: () => activeAt('2026-09-22T12:00:05.000Z')
    });
    assert.equal(decision.ok, false, `${skipped} must not authorize setup`);
    assert.equal(decision.pending, false);
    assert.match(decision.error, new RegExp(skipped));
  }
});

test('a reconcile/persistence failure never authorizes setup', async () => {
  const decision = await ensureRequestedDnsActive({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => { throw new Error('could not persist reconcile result'); },
    readResult: () => null
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.pending, false);
  assert.match(decision.error, /could not persist reconcile result/);
});

test('an unreadable durable result falls back to the reconcile outcome', async () => {
  const decision = await ensureRequestedDnsActive({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => activeAt('2026-09-22T12:00:05.000Z'),
    readResult: () => { throw new Error('EIO'); }
  });
  assert.equal(decision.ok, true);
});

test('a restart/resume admits only when the durable activation is fresh for the request', async () => {
  // Simulate a control-plane restart during admission: the next check reads the
  // durable record instead of a live return value.
  const fresh = activeAt('2026-09-22T12:00:30.000Z');
  const resumed = await ensureRequestedDnsActive({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => fresh,
    readResult: () => fresh
  });
  assert.equal(resumed.ok, true);

  const stale = activeAt('2026-09-22T11:00:00.000Z');
  const held = await ensureRequestedDnsActive({
    requestedAt: REQUESTED,
    requestedFingerprint: REQUESTED_FINGERPRINT,
    reconcileOnce: async () => stale,
    readResult: () => stale
  });
  assert.equal(held.ok, false);
});
