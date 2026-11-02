import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupCandidateImages, candidateImageServices } from '../cleanup-candidate-images.mjs';

const now = Date.parse('2026-10-29T06:00:00Z');
const hoursAgo = hours => new Date(now - hours * 3600 * 1000).toISOString();
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fake({ versions = {}, deleteStatus = 204 } = {}) {
  const calls = [];
  const request = async (url, { method, headers }) => {
    calls.push({ method, url });
    assert.equal(headers.Authorization, 'Bearer token');
    const target = new URL(url);
    if (target.pathname === '/repos/Nine-Minds/alga-psa') return response(200, { name: 'alga-psa', owner: { login: 'Nine-Minds', type: 'Organization' } });
    const match = target.pathname.match(/^\/orgs\/Nine-Minds\/packages\/container\/([^/]+)\/versions(?:\/(\d+))?$/);
    assert.ok(match, `unexpected request ${url}`);
    const name = decodeURIComponent(match[1]);
    if (method === 'DELETE') return response(deleteStatus, null);
    if (!(name in versions)) return response(404, { message: 'Package not found.' });
    const page = Number(target.searchParams.get('page'));
    return response(200, versions[name].slice((page - 1) * 100, page * 100));
  };
  return { request, calls };
}

test('every candidate service of both editions has exactly one package', () => {
  assert.deepEqual(candidateImageServices(), ['algasim', 'email-service', 'hocuspocus', 'pgbouncer', 'redis', 'server', 'server-ee', 'setup', 'temporal-worker', 'workflow-worker']);
});
test('deletes only versions older than the retention window and tolerates packages that do not exist yet', async () => {
  const old = Array.from({ length: 150 }, (_, i) => ({ id: 1000 + i, created_at: hoursAgo(80 + i) }));
  const f = fake({ versions: { 'alga-psa/e2e-server-ee': [{ id: 1, created_at: hoursAgo(1) }, { id: 2, created_at: hoursAgo(71) }, { id: 3, created_at: hoursAgo(73) }, ...old],
    'alga-psa/e2e-redis': [{ id: 7, created_at: 'not a date' }] } });
  const summary = await cleanupCandidateImages({ repository: 'Nine-Minds/alga-psa', token: 'token', maxAgeHours: 72, now, request: f.request });
  assert.equal(summary.deleted, 151); assert.equal(summary.kept, 3); assert.equal(summary.failed, 0); assert.equal(summary.missing, 9);
  const deletes = f.calls.filter(call => call.method === 'DELETE');
  assert.equal(deletes.length, 151);
  assert.ok(deletes.every(call => call.url.includes('/packages/container/alga-psa%2Fe2e-server-ee/versions/')));
  assert.ok(!deletes.some(call => /versions\/(1|2|7)$/.test(call.url)));
  assert.equal(f.calls.filter(call => call.url.includes('e2e-server-ee/versions?')).length, 2, 'paginates past 100 versions');
});
test('dry run counts without deleting and a refused delete fails the summary', async () => {
  const versions = { 'alga-psa/e2e-server': [{ id: 5, created_at: hoursAgo(100) }] };
  const dry = fake({ versions });
  const planned = await cleanupCandidateImages({ repository: 'Nine-Minds/alga-psa', token: 'token', maxAgeHours: 72, now, dryRun: true, request: dry.request });
  assert.equal(planned.deleted, 1); assert.equal(dry.calls.filter(call => call.method === 'DELETE').length, 0);
  const refused = fake({ versions, deleteStatus: 403 });
  const summary = await cleanupCandidateImages({ repository: 'Nine-Minds/alga-psa', token: 'token', maxAgeHours: 72, now, request: refused.request });
  assert.equal(summary.failed, 1); assert.equal(summary.deleted, 0);
});
test('rejects an unusable configuration before calling the API', async () => {
  for (const input of [{ repository: 'nope', token: 'token', maxAgeHours: 72 }, { repository: 'a/b', token: '', maxAgeHours: 72 }, { repository: 'a/b', token: 'token', maxAgeHours: 0 }]) {
    await assert.rejects(cleanupCandidateImages({ ...input, request: () => assert.fail('must not call the API') }));
  }
});

test('build-cache snapshots lose only their untagged, superseded versions', async () => {
  const tags = names => ({ metadata: { container: { tags: names } } });
  const f = fake({ versions: { 'alga-psa/build-cache': [
    { id: 11, created_at: hoursAgo(200), ...tags(['enterprise']) }, { id: 12, created_at: hoursAgo(200), ...tags(['community']) },
    { id: 13, created_at: hoursAgo(200), ...tags([]) }, { id: 14, created_at: hoursAgo(10), ...tags([]) }, { id: 15, created_at: hoursAgo(90) } ],
    // Candidate images go by age alone, tagged or not.
    'alga-psa/e2e-setup': [{ id: 21, created_at: hoursAgo(90), ...tags(['run-1-1-abc']) }] } });
  const summary = await cleanupCandidateImages({ repository: 'Nine-Minds/alga-psa', token: 'token', maxAgeHours: 72, now, request: f.request });
  const deleted = f.calls.filter(call => call.method === 'DELETE').map(call => Number(call.url.split('/').pop())).sort();
  assert.deepEqual(deleted, [13, 15, 21]);
  assert.equal(summary.kept, 3);
});
