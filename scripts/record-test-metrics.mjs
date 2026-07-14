#!/usr/bin/env node
/**
 * Append one row of test metrics (pass/fail counts, coverage %) to the shared
 * Google Sheet after a CI test run. See docs/reference/test-metrics.md for
 * the sheet setup and column schema.
 *
 * Inputs (env):
 *   TEST_METRICS_SUITE      required — suite label (unit-coverage, integration-full, ...)
 *   TEST_METRICS_RESULTS    path to a vitest --reporter=json output file
 *   TEST_METRICS_COVERAGE   path to a coverage-summary.json (optional)
 *   GOOGLE_SA_KEY           service-account key JSON (raw or base64)
 *   TEST_METRICS_SHEET_ID   spreadsheet id from the sheet URL
 *   TEST_METRICS_SHEET_TAB  tab name (default "metrics")
 *
 * Exits 0 without recording when the Google credentials are not configured,
 * so forks and local runs are unaffected. Pass --dry-run to print the row
 * instead of sending it.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const HEADER = [
  'timestamp_utc', 'suite', 'branch', 'commit',
  'passed', 'failed', 'skipped', 'todo', 'total', 'pass_pct',
  'lines_pct', 'statements_pct', 'branches_pct', 'functions_pct',
  'duration_s', 'run_url',
];

const DETAIL_HEADER = [
  'timestamp_utc', 'suite', 'commit', 'directory',
  'lines_pct', 'lines_covered', 'lines_total',
  'statements_pct', 'branches_pct', 'functions_pct',
  'files_measured', 'files_total', 'run_url',
];

function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.warn(`test-metrics: could not parse ${path}: ${err.message}`);
    return null;
  }
}

function testCounts(results) {
  if (!results) return null;
  const passed = results.numPassedTests ?? 0;
  const failed = results.numFailedTests ?? 0;
  const skipped = results.numPendingTests ?? 0;
  const todo = results.numTodoTests ?? 0;
  const total = results.numTotalTests ?? passed + failed + skipped + todo;
  const passPct = passed + failed > 0
    ? Math.round((passed / (passed + failed)) * 10000) / 100
    : '';
  let durationS = '';
  const files = results.testResults ?? [];
  const starts = files.map((f) => f.startTime).filter((t) => typeof t === 'number');
  const ends = files.map((f) => f.endTime).filter((t) => typeof t === 'number');
  if (starts.length && ends.length) {
    durationS = Math.round((Math.max(...ends) - Math.min(...starts)) / 1000);
  }
  return { passed, failed, skipped, todo, total, passPct, durationS };
}

function coveragePcts(summary) {
  const t = summary?.total;
  const pct = (k) => (typeof t?.[k]?.pct === 'number' ? t[k].pct : '');
  return { lines: pct('lines'), statements: pct('statements'), branches: pct('branches'), functions: pct('functions') };
}

// Group per-file coverage into directory buckets: 4 path segments under
// server/src/lib (its subtrees are whole subsystems), 3 under the rest of
// server/src, 2 for packages/shared/ee.
function coverageGroupKey(rel) {
  const parts = rel.split('/');
  let depth = 2;
  if (rel.startsWith('server/src/lib/')) depth = 4;
  else if (rel.startsWith('server/src/')) depth = 3;
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

// Count source files on disk per group. The untested-file crawl of the v8
// provider never leaves server/, so package/shared files the suite doesn't
// load are missing from the report — files_measured vs files_total makes
// that visible instead of letting the percentages read complete.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.next', 'migrations', 'seeds']);
const SRC_FILE = /\.(js|ts|jsx|tsx)$/;
const NOT_SRC = /\.d\.ts$|[.-](test|spec)\.[cm]?[jt]sx?$/;

function walkSourceFiles(absDir, relDir, counts) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('__')) {
        walkSourceFiles(join(absDir, e.name), `${relDir}/${e.name}`, counts);
      }
    } else if (SRC_FILE.test(e.name) && !NOT_SRC.test(e.name)) {
      const key = coverageGroupKey(`${relDir}/${e.name}`);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
}

function sourceFileCounts() {
  const cwd = process.cwd();
  const counts = new Map();
  walkSourceFiles(join(cwd, 'server/src'), 'server/src', counts);
  walkSourceFiles(join(cwd, 'shared'), 'shared', counts);
  const pkgRoot = join(cwd, 'packages');
  let pkgs = [];
  try {
    pkgs = readdirSync(pkgRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch { /* not run from repo root */ }
  for (const p of pkgs) {
    walkSourceFiles(join(pkgRoot, p.name, 'src'), `packages/${p.name}/src`, counts);
  }
  return counts;
}

function coverageByDirectory(summary) {
  if (!summary) return [];
  const cwd = process.cwd() + '/';
  const groups = new Map();
  for (const [file, m] of Object.entries(summary)) {
    if (file === 'total' || !m?.lines) continue;
    const rel = file.startsWith(cwd) ? file.slice(cwd.length) : file;
    const key = coverageGroupKey(rel);
    const g = groups.get(key) ?? { files: 0 };
    g.files += 1;
    for (const metric of ['lines', 'statements', 'branches', 'functions']) {
      g[metric] = {
        covered: (g[metric]?.covered ?? 0) + (m[metric]?.covered ?? 0),
        total: (g[metric]?.total ?? 0) + (m[metric]?.total ?? 0),
      };
    }
    groups.set(key, g);
  }
  const onDisk = sourceFileCounts();
  const pct = (g, k) => (g[k].total ? Math.round((g[k].covered / g[k].total) * 10000) / 100 : '');
  const rows = [...groups.entries()].map(([dir, g]) => ({
    dir,
    lines: pct(g, 'lines'), linesCovered: g.lines.covered, linesTotal: g.lines.total,
    statements: pct(g, 'statements'), branches: pct(g, 'branches'), functions: pct(g, 'functions'),
    filesMeasured: g.files, filesTotal: onDisk.get(dir) ?? '',
  }));
  // Directories with sources on disk but nothing in the report: the suite
  // never loaded them. A 0/N row is the honest record; absence would read
  // as "no such code".
  for (const [dir, total] of onDisk) {
    if (!groups.has(dir)) {
      rows.push({
        dir, lines: '', linesCovered: '', linesTotal: '',
        statements: '', branches: '', functions: '',
        filesMeasured: 0, filesTotal: total,
      });
    }
  }
  return rows.sort((a, b) => a.dir.localeCompare(b.dir));
}

function buildRow() {
  const suite = process.env.TEST_METRICS_SUITE;
  if (!suite) {
    console.error('test-metrics: TEST_METRICS_SUITE is required');
    process.exit(1);
  }
  const counts = testCounts(readJson(process.env.TEST_METRICS_RESULTS));
  const cov = coveragePcts(readJson(process.env.TEST_METRICS_COVERAGE));
  if (!counts && cov.lines === '') {
    console.warn('test-metrics: no results or coverage files found, nothing to record');
    process.exit(0);
  }
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '';
  return [
    new Date().toISOString(),
    suite,
    process.env.GITHUB_REF_NAME ?? '',
    (process.env.GITHUB_SHA ?? '').slice(0, 10),
    counts?.passed ?? '', counts?.failed ?? '', counts?.skipped ?? '', counts?.todo ?? '',
    counts?.total ?? '', counts?.passPct ?? '',
    cov.lines, cov.statements, cov.branches, cov.functions,
    counts?.durationS ?? '',
    runUrl,
  ];
}

function parseServiceAccountKey(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  }
}

async function getAccessToken(sa) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function sheetsApi(token, sheetId, pathAndQuery, method = 'GET', body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${pathAndQuery}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function ensureHeaderRow(token, sheetId, tab, header) {
  const range = encodeURIComponent(`${tab}!A1:A1`);
  let head = await sheetsApi(token, sheetId, `/values/${range}`);
  if (!head.ok && head.status === 400) {
    // Tab doesn't exist yet — create it, then fall through to write the header.
    const add = await sheetsApi(token, sheetId, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: tab } } }],
    });
    if (!add.ok) throw new Error(`could not create tab "${tab}": ${JSON.stringify(add.json)}`);
    head = { ok: true, json: {} };
  }
  if (!head.ok) throw new Error(`could not read sheet: ${head.status} ${JSON.stringify(head.json)}`);
  if (!head.json.values?.length) {
    const write = await sheetsApi(
      token, sheetId,
      `/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
      'PUT',
      { values: [header] },
    );
    if (!write.ok) throw new Error(`could not write header: ${JSON.stringify(write.json)}`);
  }
}

async function appendRows(token, sheetId, tab, header, rows) {
  await ensureHeaderRow(token, sheetId, tab, header);
  const append = await sheetsApi(
    token, sheetId,
    `/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW`,
    'POST',
    { values: rows },
  );
  if (!append.ok) throw new Error(`append to "${tab}" failed: ${append.status} ${JSON.stringify(append.json)}`);
}

const row = buildRow();
const wantDetail = process.env.TEST_METRICS_DETAIL === '1';
const detailRows = wantDetail
  ? coverageByDirectory(readJson(process.env.TEST_METRICS_COVERAGE)).map((d) => [
      row[0], row[1], row[3], d.dir,
      d.lines, d.linesCovered, d.linesTotal,
      d.statements, d.branches, d.functions,
      d.filesMeasured, d.filesTotal, row[15],
    ])
  : [];

if (process.argv.includes('--dry-run')) {
  console.log('test-metrics dry run:');
  HEADER.forEach((col, i) => console.log(`  ${col}: ${row[i]}`));
  if (wantDetail) {
    console.log(`coverage_by_dir rows (${detailRows.length}):`);
    for (const d of detailRows) console.log(`  ${d[3]}: ${d[4]}% lines (${d[5]}/${d[6]}), files ${d[10]}/${d[11]}`);
  }
  process.exit(0);
}

const rawKey = process.env.GOOGLE_SA_KEY;
const sheetId = process.env.TEST_METRICS_SHEET_ID;
if (!rawKey || !sheetId) {
  console.log('test-metrics: GOOGLE_SA_KEY / TEST_METRICS_SHEET_ID not configured, skipping');
  process.exit(0);
}

const tab = process.env.TEST_METRICS_SHEET_TAB || 'metrics';
const token = await getAccessToken(parseServiceAccountKey(rawKey));
await appendRows(token, sheetId, tab, HEADER, [row]);
if (detailRows.length) {
  await appendRows(token, sheetId, 'coverage_by_dir', DETAIL_HEADER, detailRows);
}
console.log(`test-metrics: recorded ${row[1]} run (${row[4]} passed / ${row[5]} failed)${detailRows.length ? ` + ${detailRows.length} directory rows` : ''} to sheet`);
