// One row per production-regression run: the readiness verdict the team acts
// on, which the per-suite metrics rows cannot show (a partial suite row blanks
// its pass rate, and nothing else records which lane turned main red).
import { runKind } from '../record-test-metrics.mjs';

export const GATE_SCHEMA_VERSION = 1;
export const GATE_HEADER = [
  'timestamp_utc', 'run_kind', 'event_name', 'branch', 'commit', 'run_url', 'run_attempt',
  'gate_status', 'failed_lanes', 'failed_requirements', 'quarantined_requirements',
  'failure_count', 'failures', 'schema_version',
];

const FAILURES_MAX_CHARS = 2000;

// Lanes are the orchestrator's `needs` map. Anything that is neither green nor
// deliberately skipped names a red lane, even when the aggregate is missing.
export function failedLanes(jobs) {
  return Object.entries(jobs ?? {})
    .filter(([, job]) => !['success', 'skipped'].includes(job?.result))
    .map(([name, job]) => `${name}:${job?.result ?? 'missing'}`)
    .sort();
}

export function gateStatus(aggregate) {
  if (!aggregate || typeof aggregate !== 'object') return 'missing';
  return aggregate.status === 'passed' ? 'passed' : 'failed';
}

export function buildGateRow({ aggregate, jobs, env = {}, now = new Date() }) {
  const results = Array.isArray(aggregate?.results) ? aggregate.results : [];
  const failures = Array.isArray(aggregate?.failures) ? aggregate.failures : [];
  const joined = failures.join(' | ');
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : '';
  return [
    now.toISOString(),
    runKind(env),
    env.GITHUB_EVENT_NAME ?? '',
    env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '',
    (env.GITHUB_SHA ?? '').slice(0, 12),
    runUrl,
    env.GITHUB_RUN_ATTEMPT ?? '',
    gateStatus(aggregate),
    failedLanes(jobs).join(', '),
    results.filter(r => r.status === 'failed').map(r => r.id).join(', '),
    results.filter(r => String(r.status).startsWith('quarantined')).map(r => r.id).join(', '),
    failures.length,
    joined.length > FAILURES_MAX_CHARS ? `${joined.slice(0, FAILURES_MAX_CHARS - 1)}…` : joined,
    GATE_SCHEMA_VERSION,
  ];
}
