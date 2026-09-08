import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_HEADER, browserRows } from '../record-browser-metrics.mjs';
const revision = 'a'.repeat(40);
const context = { revision, edition: 'enterprise', timestamp: '2026-09-07T00:00:00Z', runUrl: 'https://example.test/run' };
const objects = rows => rows.map(row => Object.fromEntries(BROWSER_HEADER.map((key, i) => [key, row[i]])));

test('run totals are separate from journey retries and do not double count', () => {
  const rows = objects(browserRows({ schemaVersion: 2, suite: 'production-browser', revision, status: 'failed',
    configuration: { edition: 'enterprise' },
    collected: 1, executed: 1, artifactManifest: null, journeys: [{
      identity: ['e2e-tests/tests/invoice.spec.ts', 'ee', 'enterprise', ['invoice', 'settles once']],
      required: true, observed: true, outcome: 'flaky', firstAttempt: 'failed', retryCount: 1,
    }] }, context));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].row_kind, 'run');
  assert.equal(rows[0].collected, 1);
  assert.equal(rows[0].artifact_manifest, '');
  assert.equal(rows[1].collected, '');
  assert.equal(rows[1].executed, '');
  assert.equal(rows[1].outcome, 'flaky');
  assert.equal(rows[1].first_attempt, 'failed');
  assert.equal(rows[1].retry_count, 1);
  assert.equal(rows[1].lane_status, 'failed');
});

test('empty passing flags and wrong-edition reports cannot publish a passed lane', () => {
  for (const metrics of [
    { schemaVersion: 2, suite: 'production-browser', revision, status: 'passed', collected: 0, executed: 0,
      configuration: { edition: 'enterprise' }, journeys: [] },
    { schemaVersion: 2, suite: 'production-browser', revision, status: 'passed',
      configuration: { edition: 'community' }, journeys: [] },
  ]) assert.equal(objects(browserRows(metrics, context))[0].lane_status, 'incomplete');
});

test('absent or stale browser evidence yields a visible incomplete run with unknown counts', () => {
  for (const metrics of [null, {}, { schemaVersion: 2, suite: 'production-browser', revision: 'b'.repeat(40), status: 'passed', journeys: [] }]) {
    const rows = objects(browserRows(metrics, context));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lane_status, 'incomplete');
    assert.equal(rows[0].collected, '');
    assert.equal(rows[0].tested_sha, revision);
  }
});

test('browser run and journey rows separate PR, main and nightly without moving legacy columns', () => {
  assert.deepEqual(BROWSER_HEADER.slice(0, 18), ['timestamp_utc', 'schema_version', 'row_kind', 'tested_sha', 'edition',
    'lane_status', 'run_url', 'collected', 'executed', 'project', 'file', 'journey', 'required',
    'observed', 'outcome', 'first_attempt', 'retry_count', 'artifact_manifest']);
  const metrics = { schemaVersion: 2, suite: 'production-browser', revision, status: 'passed',
    configuration: { edition: 'enterprise' }, collected: 1, executed: 1, journeys: [{
      identity: ['e2e-tests/tests/invoice.spec.ts', 'ee', 'enterprise', ['invoice']],
      required: true, observed: true, outcome: 'expected', firstAttempt: 'passed', retryCount: 0,
    }] };
  for (const [event, branch, kind] of [
    ['pull_request', '42/merge', 'pr'], ['push', 'main', 'main'], ['schedule', 'main', 'nightly'],
    ['workflow_dispatch', 'main', 'manual'], ['push', 'feature', 'branch'], ['', '', 'local'],
  ]) {
    const rows = objects(browserRows(metrics, { ...context, env: { GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: branch } }));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.run_kind, kind);
      assert.equal(row.event_name, event);
      assert.equal(row.lane_status, 'passed');
    }
  }
});

test('missing browser evidence remains incomplete in its original CI trend', () => {
  const [row] = objects(browserRows(null, { ...context,
    env: { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF_NAME: 'main' } }));
  assert.equal(row.lane_status, 'incomplete');
  assert.equal(row.collected, '');
  assert.equal(row.run_kind, 'nightly');
  assert.equal(row.event_name, 'schedule');
});
