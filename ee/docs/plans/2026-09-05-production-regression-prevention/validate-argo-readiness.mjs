import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
if (!process.argv[2]) throw new Error('Provide the patched Argo workflow YAML path');
const source = execFileSync('yq', ['-r', '.spec.templates[] | select(.name == "verify-source-readiness") | .script.source', process.argv[2]], { encoding: 'utf8' });
const helper = readFileSync(new URL('../../../../scripts/lib/published-readiness.mjs', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);
async function execute(mode) {
  const writes = new Map(); const requests = [];
  const run = { id: 10, run_number: 5, run_attempt: 2, head_sha: sha, event: 'push', path: '.github/workflows/production-regression.yml', repository: { full_name: 'Nine-Minds/alga-psa' }, status: 'completed', conclusion: mode === 'failed' ? 'failure' : 'success' };
  const context = createContext({ AbortSignal, process: { env: { SOURCE_REF: 'feature/test', SOURCE_REPO_URL: mode === 'repo' ? 'https://example.org/repo.git' : 'https://github.com/Nine-Minds/alga-psa.git', GITHUB_TOKEN: 'fixture-only' } }, fetch: async (url, opts) => {
    requests.push(url); assert.equal(opts.redirect, 'error');
    if (mode === 'http') return { ok: false, status: 503 };
    const data = url.includes('/commits/') ? { sha: mode === 'sha' ? 'main' : sha }
      : url.includes('/workflows/') ? { total_count: mode === 'missing' ? 0 : 1, workflow_runs: mode === 'missing' ? [] : [run] }
      : url.includes('/jobs?') ? { total_count: 1, jobs: [{ run_id: 10, head_sha: sha, name: 'Production regression readiness', status: 'completed', conclusion: 'success' }] } : run;
    return { ok: true, json: async () => data, text: async () => helper };
  } });
  const fs = new SyntheticModule(['writeFileSync'], function() { this.setExport('writeFileSync', (path, data) => writes.set(path, data)); }, { context });
  const script = new SourceTextModule(source, { context, importModuleDynamically: async () => {
    const downloaded = new SourceTextModule(writes.get('/tmp/published-readiness.mjs'), { context });
    await downloaded.link(() => { throw new Error('Unexpected dependency'); }); await downloaded.evaluate(); return downloaded;
  } });
  await script.link(() => fs);
  let error;
  try { await script.evaluate(); } catch (e) { error = e; }
  return { writes, requests, error };
}
test('resolves once and emits only the exact successful source SHA', async () => {
  const x = await execute('pass'); assert.equal(x.error, undefined);
  assert.equal(x.writes.get('/tmp/verified-commit-sha'), sha + '\n');
  assert.equal(JSON.parse(x.writes.get('/tmp/source-readiness.json')).status, 'passed');
  assert.equal(x.requests.filter(url => url.includes('/commits/')).length, 1);
  assert.ok(x.requests[0].endsWith('/commits/feature%2Ftest'));
  assert.ok(x.requests.some(url => url.includes('head_sha=' + sha)));
});
for (const mode of ['failed', 'missing', 'repo', 'sha', 'http']) test(`does not emit deployable SHA on ${mode}`, async () => {
  const x = await execute(mode); assert.ok(x.error); assert.equal(x.writes.has('/tmp/verified-commit-sha'), false);
});

// Argo appends an extensionless script filename to this command. Exercise the
// actual invocation as well as VM fixtures so invalid Node flags cannot pass.
test('Argo file invocation reaches repository validation', () => {
  const command = JSON.parse(execFileSync('yq', ['-o=json', '.spec.templates[] | select(.name == "verify-source-readiness") | .script.command', process.argv[2]], { encoding: 'utf8' }));
  const directory = mkdtempSync(join(tmpdir(), 'argo-readiness-command-'));
  try {
    const path = join(directory, 'script');
    writeFileSync(path, source);
    const result = spawnSync(command[0], [...command.slice(1), path], {
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, SOURCE_REPO_URL: 'https://example.invalid/untrusted.git', GITHUB_TOKEN: '' }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Source repository must match the readiness repository/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
