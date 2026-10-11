import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FLAKY_TESTS_HEADER, FLAKY_TESTS_TAB, flakyTestRows, recordFlakyTests } from '../record-flaky-tests.mjs';

const REPORT = {
  schemaVersion: 1, scope: 'flaky-test-report', generatedAt: '2026-10-05T07:00:12.000Z', windowDays: 7,
  since: '2026-09-28T07:00:12.000Z',
  tests: [
    { testId: 'src/test/unit/a.test.ts > a > flakes', suite: 'server-unit', jobs: ['server-unit shard 2/4'],
      mainOccurrences: 2, prOccurrences: 1, occurrences: 3, firstSeen: '2026-09-29T10:00:00.000Z', lastSeen: '2026-10-03T10:00:00.000Z' },
    { testId: 'journeys/login.spec.ts > signs in [community]', suite: 'production-browser', jobs: ['production-browser (community)'],
      mainOccurrences: 0, prOccurrences: 1, occurrences: 1, firstSeen: '2026-10-01T10:00:00.000Z', lastSeen: '2026-10-01T10:00:00.000Z' },
  ],
};
const ENV = { GITHUB_RUN_ID: '777', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'Nine-Minds/alga-psa',
  GOOGLE_SA_KEY: '{}', TEST_METRICS_SHEET_ID: 'sheet' };

function reportDirectory(report = REPORT) {
  const directory = mkdtempSync(path.join(tmpdir(), 'flaky-tests-'));
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report));
  return directory;
}

const requestWithRecordedRuns = runIds => async (url, options) => {
  assert.equal(options.headers.authorization, 'Bearer sheets-token');
  assert.match(decodeURIComponent(url), /flaky_tests!M2:M/);
  if (runIds === null) return new Response('{}', { status: 400 });
  return Response.json({ majorDimension: 'COLUMNS', values: runIds.length ? [runIds] : [] });
};

test('one row per test, carrying the report window and the split main/PR counts', () => {
  const rows = flakyTestRows(REPORT, { env: ENV });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, FLAKY_TESTS_HEADER.length);
  assert.deepEqual(rows[0], ['2026-10-05T07:00:12.000Z', '2026-W41', 7, '2026-09-28T07:00:12.000Z', 'server-unit',
    'src/test/unit/a.test.ts > a > flakes', 'server-unit shard 2/4', 2, 1, 3,
    '2026-09-29T10:00:00.000Z', '2026-10-03T10:00:00.000Z', '777', 'https://github.com/Nine-Minds/alga-psa/actions/runs/777', 1]);
  assert.deepEqual(rows[1].slice(4, 10), ['production-browser', 'journeys/login.spec.ts > signs in [community]',
    'production-browser (community)', 0, 1, 1]);
});

test('appends the rows to flaky_tests, creating the tab on first use', async () => {
  const appends = [];
  const result = await recordFlakyTests({ directory: reportDirectory(), env: ENV, token: 'sheets-token', log: () => {},
    request: requestWithRecordedRuns(null),
    append: async (token, sheetId, tab, header, rows) => { appends.push({ tab, header, rows }); } });
  assert.equal(result.recorded, 2);
  assert.equal(appends.length, 1);
  assert.equal(appends[0].tab, FLAKY_TESTS_TAB);
  assert.deepEqual(appends[0].header, FLAKY_TESTS_HEADER);
  assert.equal(appends[0].rows.length, 2);
});

test('a re-run of an already recorded report appends nothing', async () => {
  let appended = false;
  const result = await recordFlakyTests({ directory: reportDirectory(), env: ENV, token: 'sheets-token', log: () => {},
    request: requestWithRecordedRuns(['123', '777']), append: async () => { appended = true; } });
  assert.equal(result.recorded, 0);
  assert.equal(appended, false);
});

test('an empty window records nothing and reads nothing', async () => {
  let touched = false;
  const result = await recordFlakyTests({ directory: reportDirectory({ ...REPORT, tests: [] }), env: ENV, token: 'sheets-token',
    log: () => {}, request: async () => { touched = true; }, append: async () => { touched = true; } });
  assert.equal(result.recorded, 0);
  assert.equal(touched, false);
});

test('skips without credentials', async () => {
  let touched = false;
  const result = await recordFlakyTests({ directory: reportDirectory(), env: { ...ENV, GOOGLE_SA_KEY: '' }, log: () => {},
    request: async () => { touched = true; }, append: async () => { touched = true; } });
  assert.equal(result.recorded, 0);
  assert.equal(result.rows.length, 2);
  assert.equal(touched, false);
});

test('a report without a tests list is refused', () => {
  assert.throws(() => flakyTestRows({ generatedAt: '2026-10-05T07:00:12.000Z' }, { env: ENV }), /no tests list/);
});
