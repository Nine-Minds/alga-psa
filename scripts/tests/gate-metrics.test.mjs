import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE_HEADER, buildGateRow, failedLanes, gateStatus } from '../lib/gate-metrics.mjs';

const env = {
  GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main', GITHUB_SHA: 'abcdef0123456789abcdef0123456789abcdef01',
  GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'Nine-Minds/alga-psa', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2',
};
const now = new Date('2026-10-08T12:00:00Z');
const col = (row, name) => row[GATE_HEADER.indexOf(name)];

test('a green main push records a passed gate with no red lanes', () => {
  const row = buildGateRow({ aggregate: { status: 'passed', results: [], failures: [] }, jobs: { unit: { result: 'success' }, citus: { result: 'skipped' } }, env, now });
  assert.equal(row.length, GATE_HEADER.length);
  assert.equal(col(row, 'timestamp_utc'), '2026-10-08T12:00:00.000Z');
  assert.equal(col(row, 'run_kind'), 'main');
  assert.equal(col(row, 'branch'), 'main');
  assert.equal(col(row, 'commit'), 'abcdef012345');
  assert.equal(col(row, 'run_url'), 'https://github.com/Nine-Minds/alga-psa/actions/runs/42');
  assert.equal(col(row, 'run_attempt'), '2');
  assert.equal(col(row, 'gate_status'), 'passed');
  assert.equal(col(row, 'failed_lanes'), '');
  assert.equal(col(row, 'failure_count'), 0);
});

test('a red run names the lanes, requirements, quarantines and failures', () => {
  const aggregate = {
    status: 'failed',
    results: [
      { id: 'server-unit-aggregate', status: 'failed', failures: ['Required workflow: failure'] },
      { id: 'teams-development-execution', status: 'quarantined', failures: [] },
      { id: 'citus-aggregate', status: 'not-applicable', failures: [] },
    ],
    failures: ['server-unit-aggregate: Required workflow: failure'],
  };
  const jobs = { selection: { result: 'success' }, unit: { result: 'failure' }, browser: { result: 'cancelled' }, citus: { result: 'skipped' } };
  const row = buildGateRow({ aggregate, jobs, env: { ...env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'fix/thing', GITHUB_REF_NAME: '12/merge' }, now });
  assert.equal(col(row, 'gate_status'), 'failed');
  assert.equal(col(row, 'run_kind'), 'pr');
  assert.equal(col(row, 'branch'), 'fix/thing');
  assert.equal(col(row, 'failed_lanes'), 'browser:cancelled, unit:failure');
  assert.equal(col(row, 'failed_requirements'), 'server-unit-aggregate');
  assert.equal(col(row, 'quarantined_requirements'), 'teams-development-execution');
  assert.equal(col(row, 'failure_count'), 1);
  assert.equal(col(row, 'failures'), 'server-unit-aggregate: Required workflow: failure');
});

test('a missing aggregate is recorded as missing, never as passed', () => {
  assert.equal(gateStatus(null), 'missing');
  assert.equal(gateStatus({}), 'failed');
  const row = buildGateRow({ aggregate: null, jobs: { unit: { result: 'failure' } }, env, now });
  assert.equal(col(row, 'gate_status'), 'missing');
  assert.equal(col(row, 'failed_lanes'), 'unit:failure');
  assert.equal(col(row, 'failure_count'), 0);
});

test('failure text is bounded so one run cannot overflow a cell', () => {
  const failures = Array.from({ length: 100 }, (_, i) => `requirement-${i}: ${'x'.repeat(50)}`);
  const row = buildGateRow({ aggregate: { status: 'failed', results: [], failures }, jobs: {}, env, now });
  assert.ok(col(row, 'failures').length <= 2000);
  assert.ok(col(row, 'failures').endsWith('…'));
  assert.equal(col(row, 'failure_count'), 100);
});

test('lanes still running or absent count as red', () => {
  assert.deepEqual(failedLanes({ a: { result: 'success' }, b: {}, c: { result: 'skipped' } }), ['b:missing']);
  assert.deepEqual(failedLanes(undefined), []);
});
