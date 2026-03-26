import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStatusReport, formatStatusSummary } from '../lib/format.mjs';

test('formatStatusSummary tolerates null status', () => {
  const lines = formatStatusSummary(null);
  assert.deepEqual(lines, [
    'Site: unknown',
    'Node IP: unknown',
    'Connectivity: unknown',
    'Selected release: unknown',
  ]);
});

test('formatStatusReport tolerates null status', () => {
  const report = formatStatusReport(null);
  assert.equal(report.summary[0], 'Site: unknown');
  assert.equal(report.host[0], 'Status: unknown');
  assert.equal(report.cluster[1], 'Status: unavailable');
  assert.equal(report.release[0], 'Selected release: unknown');
});
