import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSetupRetry } from '../setup-retry.mjs';

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-retry-'));
  const stateFile = path.join(dir, 'install-state.json');
  const retryStateFile = options.retryStateFile || path.join(dir, 'auto-retry-state.json');
  let state = options.state || null;
  const launches = [];
  const controller = createSetupRetry({
    stateFile,
    retryStateFile,
    maxAttempts: options.maxAttempts || 10,
    baseMs: options.baseMs || 1000,
    maxMs: options.maxMs || 60000,
    now: options.now || (() => 1_000_000),
    probe: options.probe || (async () => ({ ok: true })),
    launch: async (info) => {
      launches.push(info);
      if (options.launchFails) return { ok: false, error: 'spawn EACCES' };
      return { ok: true, pid: launches.length };
    },
    readInstallState: () => state,
    workflowOwnerAlive: options.workflowOwnerAlive || (() => true),
    logger: options.logger || { error: () => {} }
  });
  return {
    dir,
    retryStateFile,
    controller,
    launches,
    setState: (next) => { state = next; },
    readRetry: () => (fs.existsSync(retryStateFile) ? JSON.parse(fs.readFileSync(retryStateFile, 'utf8')) : null)
  };
}

function blockedState(overrides = {}) {
  return {
    status: 'preflight-blocked',
    phase: 'dns',
    failure: { step: 'resolve-registry-host', phase: 'dns', message: 'DNS lookup failed.', details: 'no address resolved', retrySafe: true },
    ...overrides
  };
}

test('a running state never clears the retry budget or history', async () => {
  const harness = setup({ state: blockedState() });
  harness.setState({ status: 'preflight-running', phase: 'dns', failure: blockedState().failure });
  fs.writeFileSync(harness.retryStateFile, JSON.stringify({ attempts: 3, history: [{ attempt: 3 }], lastFailure: { attempt: 3 } }));

  const result = await harness.controller.reconcile();
  assert.equal(result.skipped, 'running');
  const retry = harness.readRetry();
  assert.equal(retry.attempts, 3);
  assert.equal(retry.history.length, 1);
  assert.equal(harness.launches.length, 0);
});

test('a running state whose owner died is retried instead of wedging the budget', async () => {
  const harness = setup({
    state: { status: 'storage-install-running', phase: 'storage', updatedAt: '2026-01-01T00:00:00.000Z' },
    workflowOwnerAlive: () => false
  });
  fs.writeFileSync(harness.retryStateFile, JSON.stringify({
    attempts: 1,
    lastFailure: { attempt: 1, step: 'install-local-path-storage', phase: 'storage', category: 'storage', message: 'storage reconciliation failed', retrySafe: true }
  }));

  const result = await harness.controller.reconcile();
  assert.equal(result.launched, true);
  assert.equal(harness.launches.length, 1);
  const retry = harness.readRetry();
  assert.equal(retry.attempts, 2);
  assert.equal(retry.lastFailure.step, 'install-local-path-storage');
});

test('a running state whose owner is alive is still treated as running', async () => {
  const harness = setup({
    state: { status: 'storage-install-running', phase: 'storage' },
    workflowOwnerAlive: () => true
  });
  fs.writeFileSync(harness.retryStateFile, JSON.stringify({
    attempts: 1,
    lastFailure: { attempt: 1, step: 'install-local-path-storage', phase: 'storage', retrySafe: true }
  }));
  const result = await harness.controller.reconcile();
  assert.equal(result.skipped, 'running');
  assert.equal(harness.launches.length, 0);
});

test('a missing or non-blocked state does not clear the budget', async () => {
  const harness = setup({ state: { status: 'preflight-complete', phase: 'preflight' } });
  fs.writeFileSync(harness.retryStateFile, JSON.stringify({ attempts: 2, lastFailure: { attempt: 2 } }));
  const result = await harness.controller.reconcile();
  assert.equal(result.skipped, 'not-blocked');
  assert.equal(harness.readRetry().attempts, 2);
});

test('a blocked state launches once, increments attempts, and retains the failure snapshot', async () => {
  const harness = setup({ state: blockedState() });
  const result = await harness.controller.reconcile();
  assert.equal(result.launched, true);
  assert.equal(result.attempts, 1);
  assert.equal(harness.launches.length, 1);

  const retry = harness.readRetry();
  assert.equal(retry.attempts, 1);
  assert.equal(retry.lastFailure.step, 'resolve-registry-host');
  assert.equal(retry.lastFailure.details, 'no address resolved');
  assert.equal(retry.history.length, 1);
});

test('the attempt cap is enforced exactly and survives state changes', async () => {
  // Backoff gates each launch; advance the injected clock past the window so the
  // cap — not the schedule — is what bounds the attempts.
  let clock = 1_000_000;
  const harness = setup({ state: blockedState(), maxAttempts: 3, now: () => clock });
  for (let i = 1; i <= 3; i += 1) {
    const result = await harness.controller.reconcile();
    assert.equal(result.launched, true, `attempt ${i} should launch`);
    clock += 10_000_000;
  }
  const exhausted = await harness.controller.reconcile();
  assert.equal(exhausted.skipped, 'exhausted');
  assert.equal(exhausted.attempts, 3);
  assert.equal(harness.launches.length, 3);

  const summary = harness.controller.computeAutoRetrySummary(blockedState());
  assert.equal(summary.exhausted, true);
  assert.equal(summary.attempts, 3);
  assert.equal(summary.maxAttempts, 3);
});

test('a network-class blocker waits for a healthy probe instead of launching', async () => {
  const harness = setup({
    state: blockedState({ status: 'preflight-blocked', phase: 'dns' }),
    probe: async () => ({ ok: false })
  });
  const result = await harness.controller.reconcile();
  assert.equal(result.skipped, 'network-unhealthy');
  assert.equal(harness.launches.length, 0);
  assert.match(harness.readRetry().lastReason, /network still unhealthy/);
});

test('a launch failure is retained as an attempted automatic launch', async () => {
  const harness = setup({ state: blockedState(), launchFails: true });
  const result = await harness.controller.reconcile();
  assert.equal(result.launched, false);
  const retry = harness.readRetry();
  assert.equal(retry.attempts, 1);
  assert.equal(retry.lastFailure.launchFailed, true);
  assert.match(retry.lastFailure.message, /launch failed: spawn EACCES/);
});

test('an unreadable accounting file halts automatic launch instead of resetting', async () => {
  const harness = setup({ state: blockedState() });
  fs.writeFileSync(harness.retryStateFile, '{ not json');
  const result = await harness.controller.reconcile();
  assert.equal(result.skipped, 'accounting-corrupt');
  assert.equal(harness.launches.length, 0);
  const summary = harness.controller.computeAutoRetrySummary(blockedState());
  assert.match(summary.error, /unreadable/);
});

test('an unwritable accounting path refuses to launch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-retry-blocked-'));
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');
  const harness = setup({ state: blockedState(), retryStateFile: path.join(blocker, 'auto-retry-state.json') });
  harness.setState(blockedState());
  const result = await harness.controller.reconcile();
  assert.equal(result.skipped, 'accounting-write-failed');
  assert.equal(harness.launches.length, 0);
});

test('terminal workflow success marks the budget resolved without deleting history', async () => {
  const harness = setup({ state: blockedState() });
  await harness.controller.reconcile(); // one attempt + history
  harness.controller.markResolved('workflow-success');
  const retry = harness.readRetry();
  assert.equal(retry.resolved, true);
  assert.equal(retry.resolvedReason, 'workflow-success');
  assert.equal(retry.history.length, 1);
  assert.equal(harness.controller.computeAutoRetrySummary({ status: 'release-config-complete', terminalSuccess: true, failure: null }), undefined);
});

test('an explicit manual reset clears the active budget but keeps evidence', async () => {
  const harness = setup({ state: blockedState() });
  await harness.controller.reconcile();
  harness.controller.reset('manual-setup');
  const retry = harness.readRetry();
  assert.equal(retry.attempts, 0);
  assert.equal(retry.resolved, true);
  assert.equal(retry.history.length, 1);
  // A fresh failure after the reset starts a new budget at attempt 0.
  const summary = harness.controller.computeAutoRetrySummary(blockedState());
  assert.equal(summary.willRetry, true);
  assert.equal(summary.attempts, 0);
  assert.equal(harness.controller.computeAutoRetrySummary({ status: 'setup-queued', failure: null }), undefined);
});
