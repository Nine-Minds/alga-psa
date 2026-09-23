import test from 'node:test';
import assert from 'node:assert/strict';
import { DNS_PENDING_MAX_AGE_MS, dnsReconcileLaunchBlocker, dnsBlockerMessage } from '../dns-launch-gate.mjs';

const NOW = Date.parse('2026-09-22T12:00:00.000Z');

test('an absent or successful result never blocks setup', () => {
  assert.equal(dnsReconcileLaunchBlocker(null, NOW), null);
  assert.equal(dnsReconcileLaunchBlocker(undefined, NOW), null);
  assert.equal(dnsReconcileLaunchBlocker({ ok: true, state: 'active' }, NOW), null);
  assert.equal(dnsReconcileLaunchBlocker({ ok: true }, NOW), null);
});

test('a durable failed result blocks setup with the operator-facing error', () => {
  const blocker = dnsReconcileLaunchBlocker({
    ok: false,
    state: 'failed',
    error: 'One or more workload rollouts did not become ready.'
  }, NOW);
  assert.equal(blocker.pending, false);
  assert.match(blocker.error, /rollouts/);
  assert.match(dnsBlockerMessage(blocker), /Resolve the DNS blocker/);
});

test('a fresh submitted activation blocks setup as pending', () => {
  const blocker = dnsReconcileLaunchBlocker({
    ok: null,
    state: 'submitted',
    submittedAt: new Date(NOW - 60_000).toISOString()
  }, NOW);
  assert.equal(blocker.pending, true);
  assert.match(blocker.error, /still running/);
  assert.match(dnsBlockerMessage(blocker), /Wait for host activation/);
});

test('a submitted activation older than the budget is stale and does not wedge setup', () => {
  const blocker = dnsReconcileLaunchBlocker({
    ok: null,
    state: 'submitted',
    submittedAt: new Date(NOW - DNS_PENDING_MAX_AGE_MS - 1).toISOString()
  }, NOW);
  assert.equal(blocker, null);
});
