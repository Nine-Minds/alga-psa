import assert from 'node:assert/strict';
import { DETAIL_HEADER } from '../record-test-metrics.mjs';

// coverage_by_dir takes one row per source directory per recorded coverage run
// and nothing removed them, so the tab alone reached 12 million cells and the
// workbook hit Google's 20 million cell cap. The per-run totals stay on the
// `metrics` tab, so rows past this window are deleted without a summary.
export const COVERAGE_RETENTION_DAYS = 90;
export const COVERAGE_RETENTION_WINDOW_MS = COVERAGE_RETENTION_DAYS * 86_400_000;

// The first 13 headings are the original schema; later ones were appended.
const BASE_HEADER_LENGTH = DETAIL_HEADER.indexOf('run_url') + 1;

// `header` is grid row 1 and `timestamps` is column A from grid row 2 down, so
// index 0 is grid row 2. Returns bottom-up deleteDimension ranges; it writes
// nothing.
export function planCoverageMetricsRetention({ header, timestamps, now = Date.now() } = {}) {
  assert.ok(Array.isArray(header) && header.length >= BASE_HEADER_LENGTH && header.length <= DETAIL_HEADER.length,
    'Expected the coverage_by_dir header row');
  assert.deepEqual(header, DETAIL_HEADER.slice(0, header.length), 'Expected the versioned coverage_by_dir header');
  assert.ok(Array.isArray(timestamps), 'Expected the coverage_by_dir timestamp column');
  assert.ok(Number.isSafeInteger(now) && now > 0, 'Expected a current time in milliseconds');
  const cutoff = now - COVERAGE_RETENTION_WINDOW_MS;
  const expired = [];
  let retainedRowCount = 0, unreadableTimestampCount = 0;
  timestamps.forEach((value, index) => {
    // Allocated empty rows are left to a manual grid trim rather than deleted here.
    if (value === undefined || value === null || value === '') return;
    const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
    // An unreadable timestamp cannot be proven to be outside the window, so the
    // row stays: refuse to delete rather than guess its age.
    if (Number.isNaN(timestamp)) { unreadableTimestampCount++; return; }
    if (timestamp >= cutoff) { retainedRowCount++; return; }
    expired.push({ number: index + 2, timestamp: value });
  });
  // deleteDimension indices are zero-based and end-exclusive. Blocks are emitted
  // bottom-up so applying them in order cannot shift a later block's rows.
  const deletions = [];
  for (const row of expired) {
    const last = deletions.at(-1);
    if (last && row.number === last.endIndex + 1) { last.endIndex = row.number; last.timestamps.push(row.timestamp); }
    else deletions.push({ startIndex: row.number - 1, endIndex: row.number, timestamps: [row.timestamp] });
  }
  deletions.reverse();
  return { retainedRowCount, expiredRowCount: expired.length, unreadableTimestampCount, deletions };
}
