import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRecordDirectory, expectedImageRevision } from '../lib/expected-image-revision.mjs';

const revision = 'a'.repeat(40), source = 'c'.repeat(40);
const env = { GITHUB_SHA: revision, GITHUB_RUN_ID: '500', GITHUB_RUN_ATTEMPT: '1' };
function record(service, reuse) {
  const id = `sha256:${'1'.repeat(64)}`, reported = `sha256:${'2'.repeat(64)}`;
  return { schemaVersion: 1, kind: 'docker-archive-build', registryPublication: false, revision, build: { provider: 'github-actions', runId: '500', attempt: 1 },
    service, image: `candidate-${service}`, dockerfile: 'Dockerfile', platform: 'linux/amd64', configImageId: id, buildReportedDigest: reported,
    metadata: { 'containerimage.config.digest': id, 'containerimage.digest': reported }, archive: { filename: `${service}.tar.gz`, bytes: 10, sha256: reported },
    ...(reuse ? { reuse: { sourceRevision: reuse, sourceRunId: '400', sourceAttempt: 1, artifactRunId: '400', inputs: { policy: 'scripts/image-inputs.json', sha256: reported, files: 3 } } } : {}) };
}

test('the expected label is the candidate without a record, the original build with a reuse record, and fails closed otherwise', () => {
  assert.equal(expectedImageRevision({ service: 'server-ee', env, record: null }), revision);
  assert.equal(expectedImageRevision({ service: 'server-ee', env, record: record('server-ee') }), revision);
  assert.equal(expectedImageRevision({ service: 'server-ee', env, record: record('server-ee', source) }), source);
  assert.throws(() => expectedImageRevision({ service: 'server-ee', env, record: record('pgbouncer', source) }), /does not match candidate/);
  assert.throws(() => expectedImageRevision({ service: 'server-ee', env, record: { ...record('server-ee', source), revision: 'd'.repeat(40) } }), /does not match candidate/);
  assert.throws(() => expectedImageRevision({ service: 'server-ee', env: { ...env, GITHUB_SHA: 'HEAD' }, record: null }), /Candidate revision is required/);
});

test('the CLI reads the record directory the browser job verified and prints one revision', (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'expected-revision-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const directory = path.join(temp, 'fresh-install-build-records');
  execFileSync('mkdir', ['-p', directory]);
  assert.equal(buildRecordDirectory({ RUNNER_TEMP: temp }), directory);
  assert.equal(buildRecordDirectory({ RUNNER_TEMP: temp, BUILD_RECORD_DIRECTORY: '/explicit' }), '/explicit');
  writeFileSync(path.join(directory, 'pgbouncer-build.json'), JSON.stringify(record('pgbouncer', source)));
  const cli = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../expected-image-revision.mjs');
  const run = service => execFileSync(process.execPath, [cli, service], { env: { ...process.env, ...env, RUNNER_TEMP: temp }, encoding: 'utf8' }).trim();
  assert.equal(run('pgbouncer'), source);
  assert.equal(run('server-ee'), revision, 'no record means the candidate revision');
  writeFileSync(path.join(directory, 'redis-build.json'), '{');
  assert.throws(() => run('redis'), /Expected image revision could not be established/);
});
