import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideAutoRetry,
  deferForNetwork,
  summarizeAutoRetry,
  backoffMs,
  HISTORY_LIMIT
} from '../auto-retry.mjs';

const NOW = Date.parse('2026-09-04T10:56:00.000Z');
const OPTS = { now: NOW, maxAttempts: 10, baseMs: 15_000, maxMs: 300_000 };

function blockedState(overrides = {}) {
  return {
    status: 'runtime-values-blocked',
    phase: 'install-code',
    lastAction: 'Could not redeem the install code.',
    failure: {
      phase: 'install-code',
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details: 'Install-code redemption failed (HTTP 403): <html>blocked</html>',
      retrySafe: true
    },
    ...overrides
  };
}

test('a blocked retry-safe state launches attempt 1 and records the failure', () => {
  const decision = decideAutoRetry({ state: blockedState(), retry: {}, ...OPTS });
  assert.equal(decision.action, 'retry');
  assert.equal(decision.attempt, 1);
  assert.equal(decision.requiresNetworkProbe, false);
  assert.equal(decision.retryState.attempts, 1);
  assert.equal(decision.retryState.nextAttemptAt, NOW + 15_000);
  assert.equal(decision.retryState.lastFailure.step, 'redeem-install-code');
  assert.match(decision.retryState.lastFailure.details, /HTTP 403/);
  assert.equal(decision.retryState.history.length, 1);
});

test('a re-queued run in flight holds the counter instead of clearing it', () => {
  // This is the loop bug: the reconciler used to clear the retry file whenever
  // the state was not blocked, including while its own re-run was executing,
  // so attempts reset to zero every cycle and the cap never engaged.
  const retry = { attempts: 3, nextAttemptAt: NOW + 60_000, history: [] };
  for (const status of ['setup-queued', 'preflight-running', 'storage-install-running', 'flux-install-running']) {
    const decision = decideAutoRetry({ state: { status, phase: 'storage' }, retry, ...OPTS });
    assert.deepEqual(decision, { action: 'hold', reason: 'running' }, status);
  }
});

test('the attempt counter is monotonic across blocked -> running -> blocked cycles', () => {
  let retry = {};
  let now = NOW;
  for (let cycle = 1; cycle <= 10; cycle += 1) {
    // blocked: launch a retry (backoff window has elapsed)
    const decision = decideAutoRetry({ state: blockedState(), retry, ...OPTS, now });
    assert.equal(decision.action, 'retry', `cycle ${cycle}`);
    assert.equal(decision.attempt, cycle);
    retry = decision.retryState;
    // running: the reconciler must hold
    assert.equal(decideAutoRetry({ state: { status: 'storage-install-running' }, retry, ...OPTS, now }).action, 'hold');
    now = retry.nextAttemptAt;
  }
  const exhausted = decideAutoRetry({ state: blockedState(), retry, ...OPTS, now });
  assert.equal(exhausted.action, 'exhausted');
  assert.equal(exhausted.attempts, 10);
  // backoff grew instead of staying at the base interval, and is capped
  assert.equal(retry.nextAttemptAt - Date.parse(retry.lastAttemptAt), 300_000);
  assert.equal(backoffMs(1, OPTS), 15_000);
  assert.equal(backoffMs(3, OPTS), 60_000);
  assert.equal(backoffMs(10, OPTS), 300_000);
  assert.equal(retry.history.length, Math.min(10, HISTORY_LIMIT));
});

test('a blocked state inside the backoff window waits', () => {
  const retry = { attempts: 2, nextAttemptAt: NOW + 5_000 };
  const decision = decideAutoRetry({ state: blockedState(), retry, ...OPTS });
  assert.equal(decision.action, 'backoff');
});

test('a completed setup clears the retry bookkeeping; a missing state does too', () => {
  assert.equal(decideAutoRetry({ state: { status: 'release-config-complete', phase: 'registry-release-source' }, retry: { attempts: 4 }, ...OPTS }).action, 'clear');
  assert.equal(decideAutoRetry({ state: null, retry: { attempts: 4 }, ...OPTS }).action, 'clear');
});

test('a non-retry-safe blocker (bad install code) is held, never retried', () => {
  const state = blockedState({ failure: { ...blockedState().failure, retrySafe: false, correctable: true } });
  assert.deepEqual(decideAutoRetry({ state, retry: { attempts: 2 }, ...OPTS }), { action: 'hold', reason: 'not-retry-safe' });
});

test('network-class blockers ask for a live probe and defer without spending an attempt', () => {
  const state = blockedState({
    phase: 'network',
    failure: { phase: 'network', step: 'reach-ghcr', message: 'Network failure while contacting ghcr.io.', retrySafe: true }
  });
  const decision = decideAutoRetry({ state, retry: { attempts: 2 }, ...OPTS });
  assert.equal(decision.action, 'retry');
  assert.equal(decision.requiresNetworkProbe, true);
  const deferred = deferForNetwork({ attempts: 2 }, NOW, OPTS);
  assert.equal(deferred.attempts, 2);
  assert.equal(deferred.nextAttemptAt, NOW + 30_000);
  assert.equal(deferred.lastReason, 'network still unhealthy');
});

test('history is bounded', () => {
  let retry = {};
  let now = NOW;
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    const decision = decideAutoRetry({ state: blockedState(), retry, ...OPTS, now, maxAttempts: 100 });
    retry = decision.retryState;
    now = retry.nextAttemptAt;
  }
  assert.equal(retry.history.length, HISTORY_LIMIT);
  assert.equal(retry.history.at(-1).attempt, HISTORY_LIMIT + 5);
});

test('summary while a retried run is in flight carries the last failure', () => {
  const retry = decideAutoRetry({ state: blockedState(), retry: { attempts: 2 }, ...OPTS }).retryState;
  const summary = summarizeAutoRetry({ state: { status: 'storage-install-running', phase: 'storage' }, retry, ...OPTS });
  assert.equal(summary.inFlight, true);
  assert.equal(summary.willRetry, false);
  assert.equal(summary.attempts, 3);
  assert.equal(summary.maxAttempts, 10);
  assert.equal(summary.lastFailure.step, 'redeem-install-code');
  assert.equal(summary.history.length, 1);
});

test('summary is absent for a first run and for a finished install', () => {
  assert.equal(summarizeAutoRetry({ state: { status: 'storage-install-running' }, retry: {}, ...OPTS }), undefined);
  assert.equal(summarizeAutoRetry({ state: { status: 'release-config-complete' }, retry: { attempts: 3 }, ...OPTS }), undefined);
  assert.equal(summarizeAutoRetry({ state: blockedState(), retry: { attempts: 3 }, ...OPTS, disabled: true }), undefined);
});

test('summary for a blocked state reports willRetry / exhausted like before', () => {
  const pending = summarizeAutoRetry({ state: blockedState(), retry: { attempts: 2, nextAttemptAt: NOW + 30_000 }, ...OPTS });
  assert.equal(pending.willRetry, true);
  assert.equal(pending.nextAttemptInSeconds, 30);
  const done = summarizeAutoRetry({ state: blockedState(), retry: { attempts: 10 }, ...OPTS });
  assert.equal(done.exhausted, true);
  assert.equal(done.willRetry, false);
});
