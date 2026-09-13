import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { browserArtifactServices, buildBrowserArtifactManifest } from '../lib/browser-artifact-manifest.mjs';
import { collectBrowserMetricExecutions } from '../lib/collect-browser-metric-executions.mjs';
import { reconcileBrowserMetricExecutions } from '../lib/reconcile-browser-metric-executions.mjs';
import { BROWSER_HEADER } from '../record-browser-metrics.mjs';
import { readBrowserManifestZip, resolveBrowserArtifactRevisions } from '../lib/browser-artifact-revision.mjs';
const revision = 'a'.repeat(40), head = 'b'.repeat(40);
function manifest(edition, sha = revision, attempt = 2) {
  const context = { revision: sha, edition, runId: '123', runAttempt: attempt };
  const components = browserArtifactServices(edition).map(service => {
    const digest = `sha256:${'c'.repeat(64)}`;
    const record = { schemaVersion: 1, kind: 'docker-archive-build', registryPublication: false, revision: sha,
      build: { provider: 'github-actions', runId: '123', attempt }, service, image: `candidate-${service}:test`,
      dockerfile: 'Dockerfile', platform: 'linux/amd64', configImageId: digest, buildReportedDigest: digest,
      metadata: { 'containerimage.config.digest': digest, 'containerimage.digest': digest },
      archive: { filename: `${service}.tar.gz`, bytes: 123, sha256: digest } };
    return { record, receipt: { schemaVersion: 1, kind: 'browser-ci-archive-verification', ...context, service,
      recordSha256: `sha256:${createHash('sha256').update(JSON.stringify(record)).digest('hex')}` },
      inspection: [{ Id: digest, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': sha } } }] };
  });
  return buildBrowserArtifactManifest({ ...context, components });
}
function zip(entries) {
  const result = spawnSync('python3', ['-c', 'import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED) as z:\n for name,value in json.load(sys.stdin): z.writestr(name,value)\nsys.stdout.buffer.write(b.getvalue())'],
    { input: JSON.stringify(entries), maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0); return result.stdout;
}
const member = '_temp/browser-artifact-manifest.json';
function fixture() {
  const run = { id: 123, run_attempt: 2, event: 'pull_request', head_sha: head };
  const bytes = [zip([[member, JSON.stringify(manifest('community'))]]), zip([[member, JSON.stringify(manifest('enterprise'))]])];
  const artifacts = bytes.map((buffer, index) => ({ id: index + 1, name: `fresh-install-playwright-${index ? 'enterprise' : 'community'}`,
    size_in_bytes: buffer.length, expired: false, workflow_run: { id: 123, head_sha: head } }));
  const state = { artifacts, bytes, calls: [], intercept: null };
  const request = async (input, options) => {
    const url = new URL(input); state.calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, url.hostname === 'api.github.com' ? 'Bearer secret-token' : undefined);
    const response = state.intercept?.(url); if (response) return response;
    if (url.pathname.endsWith('/artifacts')) return Response.json({ total_count: state.artifacts.length, artifacts: state.artifacts });
    if (url.pathname.endsWith('/zip')) return new Response(null, { status: 302, headers: { location: `https://productionresultssa1.blob.core.windows.net/${url.pathname.split('/').at(-2)}` } });
    if (url.hostname.endsWith('.blob.core.windows.net')) return new Response(state.bytes[Number(url.pathname.slice(1)) - 1]);
    if (url.pathname.includes('/git/commits/')) return Response.json({ sha: url.pathname.split('/').at(-1), parents: [{ sha: head }, { sha: 'c'.repeat(40) }] });
    throw new Error('Unexpected request');
  };
  return { state, request, run, resolve: () => resolveBrowserArtifactRevisions({ repository: 'nine-minds/alga-psa', run, githubToken: 'secret-token', request }) };
}
test('real ZIP manifests bind both editions and strip authorization at signed storage', async () => {
  const { state, resolve } = fixture(); const result = await resolve();
  assert.equal(result.community.revision, revision); assert.equal(result.enterprise.revisionEvidence, 'candidate-artifact');
  assert.equal(state.calls.filter(call => call.url.hostname.endsWith('.blob.core.windows.net')).length, 2);
});
for (const [name, mutate, diagnostic] of [
  ['missing', s => { s.artifacts = []; }, 'artifact-missing'],
  ['expired', s => { s.artifacts[0].expired = true; }, 'artifact-expired'],
  ['duplicate', s => { s.artifacts.push({ ...s.artifacts[0], id: 3 }); }, 'artifact-duplicate'],
  ['wrong run', s => { s.artifacts[0].workflow_run.id = 555; }, 'artifact-invalid'],
  ['untrusted redirect', s => { s.intercept = url => url.pathname.endsWith('/zip') ? new Response(null, { status: 302, headers: { location: 'https://evil.example/secret' } }) : null; }, 'artifact-invalid'],
  ['corrupt', s => { s.bytes[0] = Buffer.from('not zip'); s.artifacts[0].size_in_bytes = s.bytes[0].length; }, 'artifact-invalid'],
  ['truncated', s => { s.bytes[0] = s.bytes[0].subarray(0, -1); }, 'artifact-invalid'],
  ['stale attempt', s => { s.bytes[0] = zip([[member, JSON.stringify(manifest('community', revision, 1))]]); s.artifacts[0].size_in_bytes = s.bytes[0].length; }, 'artifact-stale-attempt'],
  ['wrong parent', s => { s.intercept = url => url.pathname.includes('/git/commits/') ? Response.json({ sha: revision, parents: [{ sha: 'c'.repeat(40) }, { sha: 'd'.repeat(40) }] }) : null; }, 'revision-unverified'],
  ['conflicting editions', s => { s.bytes[0] = zip([[member, JSON.stringify(manifest('community', 'd'.repeat(40)))]]); s.artifacts[0].size_in_bytes = s.bytes[0].length; }, 'revision-conflicting'],
  ['truncated inventory', s => { s.intercept = url => url.pathname.endsWith('/artifacts') ? Response.json({ total_count: 3, artifacts: s.artifacts }) : null; }, 'artifact-inventory-unavailable'],
]) test(`${name} remains explicit unknown evidence`, async () => {
  const { state, resolve } = fixture(); mutate(state); const result = await resolve();
  assert.equal(result.community.revision, null); assert.deepEqual(result.community.revisionDiagnostics, [diagnostic]);
});
test('duplicate fixed manifest ZIP entries reject rather than concatenating JSON', async () => {
  const data = JSON.stringify(manifest('community'));
  await assert.rejects(readBrowserManifestZip(zip([[member, data], [member, data]])));
});
test('oversized decompressed manifest rejects before unzip', async () => {
  await assert.rejects(readBrowserManifestZip(zip([[member, ' '.repeat(512 * 1024 + 1)]])));
});
test('other ZIP paths are never extracted and cannot replace the fixed manifest', async () => {
  await assert.rejects(readBrowserManifestZip(zip([['../../browser-artifact-manifest.json', '{}']])));
});


test('paginates the exact run inventory to discover late browser artifacts', async () => {
  const { state, resolve } = fixture();
  const artifacts = [...Array.from({ length: 100 }, (_, index) => ({ id: index + 10, name: `unrelated-${index}` })), ...state.artifacts];
  state.intercept = url => url.pathname.endsWith('/artifacts') ? Response.json({ total_count: artifacts.length,
    artifacts: artifacts.slice((Number(url.searchParams.get('page')) - 1) * 100, Number(url.searchParams.get('page')) * 100) }) : null;
  assert.equal((await resolve()).enterprise.revision, revision);
  assert.equal(state.calls.filter(call => call.url.pathname.endsWith('/artifacts')).length, 2);
});

for (const missing of [false, true]) test(`artifact collector→core ${missing ? 'cancelled with unknown source' : 'current source and complete exports'}`, async () => {
  const { state, request: artifactRequest, run } = fixture();
  Object.assign(run, { repository: { full_name: 'Nine-Minds/alga-psa' }, path: '.github/workflows/production-regression.yml',
    status: 'completed', conclusion: missing ? 'cancelled' : 'success' });
  if (missing) state.artifacts = [];
  const jobs = missing ? [] : ['community', 'enterprise'].map((edition, index) => ({ id: index + 1,
    run_id: 123, run_attempt: 2, head_sha: head, name: `browser / Production browser (${edition})`,
    status: 'completed', conclusion: 'success', steps: [{ name: 'Record browser journey readiness', status: 'completed', conclusion: 'success' }] }));
  const rows = [];
  for (const edition of ['community', 'enterprise']) {
    const common = { schema_version: 2, tested_sha: revision, edition, event_name: 'pull_request', run_id: '123', run_attempt: 2,
      run_url: 'https://github.com/nine-minds/alga-psa/actions/runs/123', lane_status: 'passed',
      authentication: 'real-credentials', server_lifecycle: 'externally-started-production-build' };
    for (const fields of [{ row_kind: 'run', collected: 1, executed: 1 }, { row_kind: 'journey', project_id: edition, project: edition,
      file: 'test.spec.ts', journey: '["journey"]', required: true, observed: true, outcome: 'expected', first_attempt: 'passed', retry_count: 0 }])
      rows.push(BROWSER_HEADER.map(column => ({ ...common, ...fields })[column] ?? ''));
  }
  const request = async (url, options) => {
    if (url.endsWith('/actions/runs/123')) return Response.json(run);
    if (url.includes('/jobs?')) return Response.json({ total_count: jobs.length, jobs });
    if (url.includes('/values/')) return Response.json({ majorDimension: 'ROWS', values: [BROWSER_HEADER, ...rows] });
    if (url.includes('sheets.googleapis.com')) return Response.json({ spreadsheetId: 'sheet', sheets: [{ properties: {
      title: 'browser_readiness', gridProperties: { rowCount: 10, columnCount: 25 } } }] });
    return artifactRequest(url, options);
  };
  const collected = await collectBrowserMetricExecutions({ repository: 'Nine-Minds/alga-psa', runId: '123', revisionMode: 'artifact',
    sheetId: 'sheet', githubToken: 'secret-token', sheetsToken: 'sheet-token', request });
  const reconciled = reconcileBrowserMetricExecutions(collected);
  assert.equal(reconciled.status, missing ? 'incomplete' : 'passed');
  if (missing) assert.ok(reconciled.records.every(record => record.revision === null && record.status === 'cancelled'
    && record.exportStatus === 'tested-revision-unknown'));
  else assert.ok(reconciled.records.every(record => record.revision === revision && record.revisionEvidence === 'candidate-artifact'));
});
