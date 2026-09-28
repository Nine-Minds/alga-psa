// Aggregation of the per-run flaky-tests artifacts the browser and server-unit
// jobs publish. Pure: the collector supplies already downloaded documents.
// Every document arrives from CI storage, so nothing is trusted — bounded
// shapes only, and anything unrecognised is rejected with a local code rather
// than echoed into the report.
export const FLAKY_SUITES = ['production-browser', 'server-unit'];
const LIMITS = { tests: 500, rows: 500, runIds: 50, jobs: 20, testId: 512, text: 400, artifactName: 120 };

const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;

function readDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return 'unreadable-document';
  if (document.schemaVersion !== 1) return 'unsupported-schema-version';
  if (!FLAKY_SUITES.includes(document.suite)) return 'unknown-suite';
  if (!text(document.job, LIMITS.text)) return 'invalid-job';
  if (!Array.isArray(document.tests) || document.tests.length > LIMITS.tests) return 'invalid-test-list';
  const seen = new Set();
  for (const entry of document.tests) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'invalid-test-entry';
    if (!text(entry.testId, LIMITS.testId) || seen.has(entry.testId)) return 'invalid-test-identity';
    if (!text(entry.file, LIMITS.text) || !text(entry.name, LIMITS.text)) return 'invalid-test-entry';
    if (entry.retryCount !== undefined && !count(entry.retryCount, 1000)) return 'invalid-retry-count';
    seen.add(entry.testId);
  }
  return null;
}

export function aggregateFlakyTests(artifacts, { windowDays = 7, generatedAt = new Date().toISOString() } = {}) {
  const now = Date.parse(generatedAt);
  if (!Number.isFinite(now)) throw new Error('Invalid report timestamp');
  const since = new Date(now - windowDays * 86_400_000).toISOString();
  const rejected = [];
  const accepted = [];
  const runs = new Set();
  const rows = new Map();
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const name = artifact?.artifactName;
    const runId = String(artifact?.runId ?? '');
    const reject = code => rejected.push({ artifactName: text(name, LIMITS.artifactName) ? name : null, runId: /^[0-9]{1,20}$/.test(runId) ? runId : null, code });
    if (!text(name, LIMITS.artifactName) || !name.startsWith('flaky-tests-')) { reject('unexpected-artifact-name'); continue; }
    if (!/^[0-9]{1,20}$/.test(runId)) { reject('invalid-run-id'); continue; }
    const created = Date.parse(artifact?.createdAt ?? '');
    if (!Number.isFinite(created)) { reject('invalid-created-at'); continue; }
    const observedAt = new Date(created).toISOString();
    if (observedAt < since || created > now) { reject('outside-window'); continue; }
    const failure = readDocument(artifact.document);
    if (failure) { reject(failure); continue; }
    const { suite, job, tests } = artifact.document;
    accepted.push({ artifactName: name, runId, suite, job, observedAt, testCount: tests.length });
    runs.add(runId);
    for (const entry of tests) {
      const key = JSON.stringify([suite, entry.testId]);
      const row = rows.get(key) ?? { testId: entry.testId, suite, jobs: [], artifactNames: [], occurrences: 0,
        firstSeen: observedAt, lastSeen: observedAt, runIds: [] };
      row.occurrences++;
      if (observedAt > row.lastSeen) row.lastSeen = observedAt;
      if (observedAt < row.firstSeen) row.firstSeen = observedAt;
      for (const [list, value, limit] of [[row.jobs, job, LIMITS.jobs], [row.artifactNames, name, LIMITS.jobs], [row.runIds, runId, LIMITS.runIds]]) {
        if (!list.includes(value) && list.length < limit) list.push(value);
      }
      rows.set(key, row);
    }
  }
  const ordered = [...rows.values()]
    .map(row => ({ ...row, jobs: [...row.jobs].sort(), artifactNames: [...row.artifactNames].sort(), runIds: [...row.runIds].sort() }))
    .sort((a, b) => b.occurrences - a.occurrences || b.lastSeen.localeCompare(a.lastSeen)
      || a.suite.localeCompare(b.suite) || a.testId.localeCompare(b.testId));
  return {
    schemaVersion: 1, scope: 'flaky-test-report', generatedAt: new Date(now).toISOString(), windowDays, since,
    summary: { artifactsAccepted: accepted.length, artifactsRejected: rejected.length, runsObserved: runs.size,
      flakyTests: ordered.length, occurrences: ordered.reduce((total, row) => total + row.occurrences, 0),
      truncated: ordered.length > LIMITS.rows },
    tests: ordered.slice(0, LIMITS.rows), sources: accepted, rejected,
  };
}

const cell = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function renderFlakyTestReport(report) {
  const { summary } = report;
  const lines = [`## Flaky tests (last ${report.windowDays} days)`, '',
    `${summary.flakyTests} flaky test${summary.flakyTests === 1 ? '' : 's'} across `
    + `${summary.artifactsAccepted} artifact${summary.artifactsAccepted === 1 ? '' : 's'} from ${summary.runsObserved} run${summary.runsObserved === 1 ? '' : 's'}`
    + ` (${summary.artifactsRejected} artifact${summary.artifactsRejected === 1 ? '' : 's'} rejected).`, ''];
  if (!report.tests.length) {
    lines.push('No retry-only pass was recorded in this window.', '');
  } else {
    lines.push('| Test | Suite | Job | Count | Last seen |', '| --- | --- | --- | --- | --- |');
    for (const row of report.tests) {
      lines.push(`| ${cell(row.testId)} | ${cell(row.suite)} | ${cell(row.jobs.join(', '))} | ${row.occurrences} | ${cell(row.lastSeen)} |`);
    }
    lines.push('');
    if (summary.truncated) lines.push(`Only the first ${report.tests.length} tests are listed.`, '');
  }
  if (report.rejected.length) {
    const codes = [...new Set(report.rejected.map(entry => entry.code))].sort();
    lines.push(`Rejected artifact codes: ${codes.map(code => `\`${cell(code)}\``).join(', ')}.`, '');
  }
  return lines.join('\n');
}
