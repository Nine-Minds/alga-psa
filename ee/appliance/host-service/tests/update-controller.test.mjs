import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createUpdateCoordinator, reconcileInterruptedUpdate } from '../update-controller.mjs';

const fixedDate = new Date('2026-08-03T20:00:00.000Z');
const silentLogger = { info() {}, warn() {} };

function fixture(state, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-update-controller-'));
  const stateFile = path.join(dir, 'install-state.json');
  const historyFile = path.join(dir, 'update-history.json');
  if (state) fs.writeFileSync(stateFile, JSON.stringify(state));
  const spawned = [];
  const coordinator = createUpdateCoordinator({
    stateFile,
    historyFile,
    now: () => fixedDate,
    pidIsAlive: () => false,
    maxAgeMs: 6 * 60 * 60 * 1000,
    logger: silentLogger,
    spawnUpdate: (channel, startedAt) => {
      spawned.push({ channel, startedAt });
      return 9001;
    },
    ...overrides
  });
  return { coordinator, stateFile, historyFile, spawned };
}

function inProgress(pid = 42) {
  return {
    status: 'update-running',
    updatedAt: '2026-08-03T19:00:00.000Z',
    update: {
      requestedChannel: 'stable',
      scope: 'application-only',
      owner: { pid, startedAt: '2026-08-03T19:00:00.000Z' }
    }
  };
}

test('boot reconciliation turns a dead owner into a durable interrupted state', () => {
  const { stateFile, historyFile } = fixture(inProgress());
  const result = reconcileInterruptedUpdate({
    stateFile,
    historyFile,
    now: () => fixedDate,
    pidIsAlive: () => false,
    logger: silentLogger
  });
  assert.equal(result.classification.status, 'dead');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'update-blocked');
  assert.equal(state.failure.category, 'update-interrupted');
  assert.equal(state.update.owner, undefined);
  const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  assert.equal(history.history[0].category, 'update-interrupted');
});

test('boot reconciliation preserves a fresh live owner', () => {
  const { coordinator, stateFile } = fixture(inProgress(), { pidIsAlive: () => true });
  const result = coordinator.reconcile();
  assert.equal(result.classification.status, 'live');
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).status, 'update-running');
});

test('live owner returns structured 409 without spawning or writing', () => {
  const { coordinator, stateFile, spawned } = fixture(inProgress(), { pidIsAlive: () => true });
  const before = fs.readFileSync(stateFile, 'utf8');
  const result = coordinator.start('nightly');
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'update_in_progress');
  assert.equal(result.body.startedAt, '2026-08-03T19:00:00.000Z');
  assert.equal(spawned.length, 0);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
});

test('dead owner is reconciled before a new generation starts', () => {
  const { coordinator, stateFile, historyFile, spawned } = fixture(inProgress());
  const result = coordinator.start('nightly');
  assert.equal(result.status, 202);
  assert.equal(spawned.length, 1);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'update-queued');
  assert.equal(state.update.owner.pid, 9001);
  assert.equal(state.update.requestedChannel, 'nightly');
  assert.equal(JSON.parse(fs.readFileSync(historyFile, 'utf8')).history[0].category, 'update-interrupted');
});

test('simultaneous starts produce one child and one live-owner 409', async () => {
  let livePid = null;
  const { coordinator, spawned } = fixture(null, {
    pidIsAlive: (pid) => pid === livePid,
    spawnUpdate: (channel, startedAt) => {
      spawned.push({ channel, startedAt });
      livePid = 77;
      return livePid;
    }
  });
  const results = await Promise.all([
    Promise.resolve().then(() => coordinator.start('stable')),
    Promise.resolve().then(() => coordinator.start('stable'))
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [202, 409]);
  assert.equal(spawned.length, 1);
});

test('spawn failure does not publish an orphaned running state', () => {
  const { coordinator, stateFile } = fixture(null, {
    spawnUpdate: () => { throw new Error('spawn failed'); }
  });
  assert.throws(() => coordinator.start('stable'), /spawn failed/);
  assert.equal(fs.existsSync(stateFile), false);
});

test('a child-published terminal state is not overwritten by the parent queue write', () => {
  let statePath;
  const fixtureResult = fixture(null, {
    spawnUpdate: (channel, startedAt) => {
      fs.writeFileSync(statePath, JSON.stringify({
        status: 'update-blocked',
        failure: { message: 'failed immediately' },
        update: { requestedChannel: channel, scope: 'application-only', startedAt }
      }));
      return 88;
    }
  });
  statePath = fixtureResult.stateFile;
  const result = fixtureResult.coordinator.start('stable');
  assert.equal(result.status, 202);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).status, 'update-blocked');
});

test('setup state is outside the app-update guard', () => {
  const { coordinator, stateFile } = fixture({ status: 'setup-queued', phase: 'setup' });
  const result = coordinator.start('stable');
  assert.equal(result.status, 202);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).status, 'update-queued');
});
