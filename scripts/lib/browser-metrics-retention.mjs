import assert from 'node:assert/strict';
import { BROWSER_HEADER } from '../record-browser-metrics.mjs';

// Raw browser_readiness rows are kept for at least this long. Every production
// regression run appends roughly 80 rows and nothing ever removed them, so the
// tab grew without limit; this window bounds it while weekly summaries keep the
// long-term trend. Reconciliation imports the window to tell an absent export
// from one whose rows are simply past retention.
export const BROWSER_RETENTION_DAYS = 90;
export const BROWSER_RETENTION_WINDOW_MS = BROWSER_RETENTION_DAYS * 86_400_000;
const WEEK_MS = 7 * 86_400_000;

export const BROWSER_WEEKLY_HEADER = ['week', 'edition', 'run_kind', 'runs', 'passed', 'failed',
  'incomplete', 'journeys_with_retry', 'median_collected', 'median_executed', 'archived_rows',
  'schema_version', 'summarized_at_utc'];

export function isoWeekStart(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
}

export function isoWeek(value) {
  const monday = isoWeekStart(value);
  const year = new Date(monday + 3 * 86_400_000).getUTCFullYear();
  const week = Math.round((monday - isoWeekStart(Date.UTC(year, 0, 4))) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Weeks are the summary grain, so they are also the archive grain: one key is
// written once and its raw rows leave together.
export const browserSummaryKey = (week, edition, runKind) => JSON.stringify([week, edition, runKind]);

const number = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))
  && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

const median = samples => {
  if (!samples.length) return '';
  const sorted = [...samples].sort((a, b) => a - b), middle = sorted.length >> 1;
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 100) / 100;
};

// `values` is the browser_readiness grid from row 1, so index 0 is the header
// and grid row numbers are index + 1. Returns the summaries to append, the raw
// rows they replace and bottom-up deleteDimension ranges; it writes nothing.
export function planBrowserMetricsRetention({ values, now = Date.now(), existingSummaryKeys = [] } = {}) {
  assert.ok(Array.isArray(values) && values.length > 0, 'Expected the browser_readiness grid including its header row');
  const header = values[0];
  assert.ok(Array.isArray(header) && [18, 20, 25].includes(header.length)
    && header.every(cell => typeof cell === 'string'), 'Expected a recognized browser metrics header');
  assert.deepEqual(header, BROWSER_HEADER.slice(0, header.length), 'Expected the versioned browser metrics header');
  assert.ok(Number.isSafeInteger(now) && now > 0, 'Expected a current time in milliseconds');
  const cutoff = now - BROWSER_RETENTION_WINDOW_MS;
  const summarized = new Set(existingSummaryKeys);
  const archived = [], groups = new Map();
  let retainedRowCount = 0, unreadableTimestampCount = 0;
  values.slice(1).forEach((row, index) => {
    // Allocated empty rows carry nothing to summarize and are left to a manual
    // grid trim rather than deleted here.
    if (!Array.isArray(row) || row.length === 0) return;
    const cells = Object.fromEntries(BROWSER_HEADER.map((column, position) => [column, row[position] ?? '']));
    const timestamp = typeof cells.timestamp_utc === 'string' ? Date.parse(cells.timestamp_utc) : NaN;
    // An unreadable timestamp cannot be proven to be outside the window, so the
    // row stays: refuse to delete rather than guess its age.
    if (Number.isNaN(timestamp)) { unreadableTimestampCount++; return; }
    // Whole ISO weeks only. A week whose last instant still falls inside the
    // window waits for a later run, so a week is never summarized twice from
    // two different halves of its rows.
    if (isoWeekStart(timestamp) + WEEK_MS > cutoff) { retainedRowCount++; return; }
    const week = isoWeek(timestamp);
    const edition = cells.edition === '' ? 'unknown' : String(cells.edition);
    const runKind = cells.run_kind === '' ? 'unknown' : String(cells.run_kind);
    const key = browserSummaryKey(week, edition, runKind);
    let group = groups.get(key);
    if (!group) {
      group = { key, week, edition, runKind, runs: 0, passed: 0, failed: 0, incomplete: 0,
        journeysWithRetry: 0, archivedRows: 0, collected: [], executed: [] };
      groups.set(key, group);
    }
    group.archivedRows++;
    if (cells.row_kind === 'run') {
      group.runs++;
      if (['passed', 'failed', 'incomplete'].includes(cells.lane_status)) group[cells.lane_status]++;
      const collected = number(cells.collected), executed = number(cells.executed);
      if (collected !== null) group.collected.push(collected);
      if (executed !== null) group.executed.push(executed);
    } else if (cells.row_kind === 'journey' && (number(cells.retry_count) ?? 0) > 0) group.journeysWithRetry++;
    archived.push({ number: index + 2, timestamp: String(cells.timestamp_utc), key });
  });
  const summaries = [...groups.values()]
    .map(({ collected, executed, ...group }) => ({ ...group,
      medianCollected: median(collected), medianExecuted: median(executed),
      alreadySummarized: summarized.has(group.key) }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const summarizedAt = new Date(now).toISOString();
  const summaryRows = summaries.filter(summary => !summary.alreadySummarized)
    .map(summary => [summary.week, summary.edition, summary.runKind, summary.runs, summary.passed,
      summary.failed, summary.incomplete, summary.journeysWithRetry, summary.medianCollected,
      summary.medianExecuted, summary.archivedRows, 1, summarizedAt]);
  // deleteDimension indices are zero-based and end-exclusive. Blocks are emitted
  // bottom-up so applying them in order cannot shift a later block's rows.
  const deletions = [];
  for (const row of archived) {
    const last = deletions.at(-1);
    if (last && row.number === last.endIndex + 1) { last.endIndex = row.number; last.timestamps.push(row.timestamp); }
    else deletions.push({ startIndex: row.number - 1, endIndex: row.number, timestamps: [row.timestamp] });
  }
  deletions.reverse();
  return { header: [...header], retainedRowCount, archivedRowCount: archived.length,
    unreadableTimestampCount, summaries, summaryRows, deletions };
}
