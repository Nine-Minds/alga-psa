import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublishedReadiness } from '../lib/published-readiness.mjs';
const revision = 'a'.repeat(40);
function fixture() {
  const run = { id: 10, run_number: 5, run_attempt: 2, head_sha: revision, event: 'push', path: '.github/workflows/production-regression.yml', repository: { full_name: 'Nine-Minds/alga-psa' }, status: 'completed', conclusion: 'success' };
  return { runs: [run], current: structuredClone(run), jobs: [{ id: 99, run_id: 10, head_sha: revision, name: 'Production regression readiness', status: 'completed', conclusion: 'success' }] };
}
async function verify(data) {
  const urls = [];
  const result = await verifyPublishedReadiness({ revision, fetchImpl: async (url, options) => {
    urls.push(url); assert.equal(options.redirect, 'error');
    const body = url.includes('/workflows/') ? { total_count: data.runs.length, workflow_runs: data.runs }
      : url.includes('/jobs?') ? { total_count: data.jobs.length, jobs: data.jobs } : data.current;
    return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) };
  } });
  return { result, urls };
}
test('requires the named gate in the exact successful workflow attempt', async () => {
  const { result, urls } = await verify(fixture());
  assert.equal(result.status, 'passed');
  assert.ok(urls.some(url => url.includes('/runs/10/attempts/2/jobs')));
});
for (const [name, mutate] of [
  ['missing workflow', x => { x.runs = []; }],
  ['wrong commit', x => { x.runs[0].head_sha = 'b'.repeat(40); }],
  ['PR-only result', x => { x.runs[0].event = 'pull_request'; }],
  ['wrong workflow', x => { x.runs[0].path = '.github/workflows/other.yml'; }],
  ['wrong repository', x => { x.runs[0].repository.full_name = 'other/repo'; }],
  ['missing gate', x => { x.jobs = []; }],
  ['skipped gate', x => { x.jobs[0].conclusion = 'skipped'; }],
  ['duplicate gate', x => { x.jobs.push(x.jobs[0]); }],
  ['wrong job commit', x => { x.jobs[0].head_sha = 'b'.repeat(40); }],
  ['new failed run', x => { x.runs.push({ ...x.runs[0], id: 11, run_number: 6, conclusion: 'failure' }); }],
  ['new pending run', x => { x.runs.push({ ...x.runs[0], id: 11, run_number: 6, status: 'in_progress', conclusion: null }); }],
  ['concurrent rerun', x => { x.current.run_attempt++; }],
]) test(`rejects ${name}`, async () => { const data = fixture(); mutate(data); assert.equal((await verify(data)).result.status, 'failed'); });
test('HTTP and malformed API responses fail closed without reporting response bodies', async () => {
  for (const response of [{ ok: false, status: 503 }, { ok: true, json: async () => ({}) }]) {
    assert.equal((await verifyPublishedReadiness({ revision, fetchImpl: async () => response })).status, 'failed');
  }
});
