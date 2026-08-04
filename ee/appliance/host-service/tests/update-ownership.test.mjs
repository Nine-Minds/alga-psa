import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyUpdateOwner,
  interruptedUpdateState,
  isPidAlive,
  isUpdateInProgressStatus
} from '../update-ownership.mjs';

const nowMs = Date.parse('2026-08-03T20:00:00.000Z');

function runningState(owner = { pid: 42, startedAt: '2026-08-03T19:00:00.000Z' }) {
  return {
    status: 'update-running',
    phase: 'storage',
    update: { requestedChannel: 'stable', scope: 'application-only', owner }
  };
}

test('recognizes only app-update in-progress statuses', () => {
  for (const status of ['update-queued', 'update-running', 'release-config-running', 'storage-install-running']) {
    assert.equal(isUpdateInProgressStatus(status), true, status);
  }
  for (const status of ['setup-queued', 'setup-running', 'runtime-values-running', 'update-blocked', 'update-complete']) {
    assert.equal(isUpdateInProgressStatus(status), false, status);
  }
});

test('classifies a fresh live owner', () => {
  const result = classifyUpdateOwner(runningState(), {
    nowMs,
    maxAgeMs: 2 * 60 * 60 * 1000,
    isPidAlive: () => true
  });
  assert.equal(result.status, 'live');
  assert.equal(result.owner.pid, 42);
});

test('process liveness treats ESRCH as dead and EPERM as present', () => {
  assert.equal(isPidAlive(42, () => {
    const error = new Error('missing');
    error.code = 'ESRCH';
    throw error;
  }), false);
  assert.equal(isPidAlive(42, () => {
    const error = new Error('permission denied');
    error.code = 'EPERM';
    throw error;
  }), true);
});

test('classifies dead, aged, malformed, missing, and future owners', () => {
  assert.equal(classifyUpdateOwner(runningState(), { nowMs, isPidAlive: () => false }).status, 'dead');
  assert.equal(classifyUpdateOwner(runningState(), {
    nowMs,
    maxAgeMs: 30 * 60 * 1000,
    isPidAlive: () => true
  }).status, 'aged');
  assert.equal(classifyUpdateOwner(runningState({ pid: '42', startedAt: 'invalid' }), { nowMs }).status, 'invalid');
  assert.equal(classifyUpdateOwner(runningState(null), { nowMs }).status, 'invalid');
  assert.equal(classifyUpdateOwner(runningState({ pid: 42, startedAt: '2026-08-03T21:00:00.000Z' }), { nowMs }).status, 'invalid');
});

test('builds a canonical retry-safe interruption while preserving update intent', () => {
  const original = runningState();
  const classification = { status: 'dead', reason: 'interrupted by control-plane restart' };
  const state = interruptedUpdateState(original, classification, '2026-08-03T20:00:00.000Z');
  assert.equal(state.status, 'update-blocked');
  assert.equal(state.phase, 'update-interrupted');
  assert.equal(state.failure.category, 'update-interrupted');
  assert.equal(state.failure.retrySafe, true);
  assert.equal(state.update.requestedChannel, 'stable');
  assert.equal(state.update.scope, 'application-only');
  assert.equal(state.update.startedAt, '2026-08-03T19:00:00.000Z');
  assert.equal(state.update.owner, undefined);
});
