// Aggregation of the per-run flaky-tests artifacts the browser and server-unit
// jobs publish. Pure: the collector supplies already downloaded documents.
// Every document arrives from CI storage, so nothing is trusted — bounded
// shapes only, and anything unrecognised is rejected with a local code rather
// than echoed into the report.
export const FLAKY_SUITES = ['production-browser', 'server-unit', 'integration', 'infrastructure'];
const LIMITS = { tests: 500, rows: 500, runIds: 50, jobs: 20, testId: 512, text: 400, artifactName: 120,
  events: 10, branches: 20, eventName: 60, branch: 255 };
// Artifacts written before this card carry neither field, and they stay
// aggregatable for their thirty-day retention rather than being rejected.
const UNKNOWN_EVENT = 'unknown';

const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const absent = value => value === undefined || value === null;

function readDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return 'unreadable-document';
  if (document.schemaVersion !== 1) return 'unsupported-schema-version';
  if (!FLAKY_SUITES.includes(document.suite)) return 'unknown-suite';
  if (!text(document.job, LIMITS.text)) return 'invalid-job';
  if (!absent(document.eventName) && !text(document.eventName, LIMITS.eventName)) return 'invalid-event-name';
  if (!absent(document.branch) && !text(document.branch, LIMITS.branch)) return 'invalid-branch';
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

// How much of the window was actually inspected. An absent flake only means
// something if the collector got through the whole week, so a capped, timed-out
// or partly unreadable collection has to say so next to the table.
function readCoverage(coverage) {
  if (coverage === null || coverage === undefined) return null;
  const limits = Array.isArray(coverage.limits) ? coverage.limits.filter(code => text(code, 60)) : [];
  return {
    runsInspected: count(coverage.runsInspected, 1_000_000) ? coverage.runsInspected : null,
    complete: coverage.complete === true && limits.length === 0,
    limits: [...new Set(limits)].sort().slice(0, 10),
  };
}

export function aggregateFlakyTests(artifacts, { windowDays = 7, generatedAt = new Date().toISOString(), coverage = null } = {}) {
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
    const eventName = absent(artifact.document.eventName) ? UNKNOWN_EVENT : artifact.document.eventName;
    const branch = absent(artifact.document.branch) ? UNKNOWN_EVENT : artifact.document.branch;
    accepted.push({ artifactName: name, runId, suite, job, eventName, branch, observedAt, testCount: tests.length });
    runs.add(runId);
    for (const entry of tests) {
      const key = JSON.stringify([suite, entry.testId]);
      const row = rows.get(key) ?? { testId: entry.testId, suite, jobs: [], artifactNames: [], occurrences: 0,
        // A flake on a contributor's branch and the same flake on main are not
        // the same news, so they are counted apart rather than summed.
        events: {}, branches: [], prOccurrences: 0, mainOccurrences: 0,
        firstSeen: observedAt, lastSeen: observedAt, runIds: [] };
      row.occurrences++;
      if (eventName === 'pull_request') row.prOccurrences++; else row.mainOccurrences++;
      if (row.events[eventName] !== undefined || Object.keys(row.events).length < LIMITS.events) {
        row.events[eventName] = (row.events[eventName] ?? 0) + 1;
      }
      if (observedAt > row.lastSeen) row.lastSeen = observedAt;
      if (observedAt < row.firstSeen) row.firstSeen = observedAt;
      for (const [list, value, limit] of [[row.jobs, job, LIMITS.jobs], [row.artifactNames, name, LIMITS.jobs],
        [row.runIds, runId, LIMITS.runIds], [row.branches, branch, LIMITS.branches]]) {
        if (!list.includes(value) && list.length < limit) list.push(value);
      }
      rows.set(key, row);
    }
  }
  const ordered = [...rows.values()]
    .map(row => ({ ...row, jobs: [...row.jobs].sort(), artifactNames: [...row.artifactNames].sort(),
      runIds: [...row.runIds].sort(), branches: [...row.branches].sort(),
      events: Object.fromEntries(Object.entries(row.events).sort(([a], [b]) => a.localeCompare(b))) }))
    .sort((a, b) => b.occurrences - a.occurrences || b.lastSeen.localeCompare(a.lastSeen)
      || a.suite.localeCompare(b.suite) || a.testId.localeCompare(b.testId));
  return {
    schemaVersion: 1, scope: 'flaky-test-report', generatedAt: new Date(now).toISOString(), windowDays, since,
    coverage: readCoverage(coverage),
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
  const runs = report.coverage?.runsInspected;
  if (report.coverage) {
    lines.push(report.coverage.complete
      ? `Inspected every flaky-reporting workflow run in the window (${runs === null ? 'count unavailable' : runs}).`
      : `**Partial coverage** — ${runs === null ? 'an unknown number of' : runs} workflow run(s) inspected`
        + `${report.coverage.limits.length ? ` (${report.coverage.limits.map(code => `\`${cell(code)}\``).join(', ')})` : ''}.`
        + ' An absent test below is not evidence that it is stable.', '');
  }
  if (!report.tests.length) {
    lines.push('No retry-only pass was recorded in this window.', '');
  } else {
    // Main and PR are split out: a test that only flakes on pull requests is a
    // different problem from one that flakes on a merged revision.
    lines.push('| Test | Suite | Job | Main | PR | Count | Last seen |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const row of report.tests) {
      lines.push(`| ${cell(row.testId)} | ${cell(row.suite)} | ${cell(row.jobs.join(', '))} `
        + `| ${row.mainOccurrences} | ${row.prOccurrences} | ${row.occurrences} | ${cell(row.lastSeen)} |`);
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
