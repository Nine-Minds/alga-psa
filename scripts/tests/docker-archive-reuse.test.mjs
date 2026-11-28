import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { findReusableBuild, orderSourceRuns } from '../lib/docker-archive-reuse.mjs';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
import { recordDockerRegistryBuild } from '../record-docker-registry-build.mjs';
import { verifyDockerArchive, verifyLoadedDockerImage } from '../verify-docker-archive-build.mjs';

const sourceRevision = 'b'.repeat(40), candidateRevision = 'c'.repeat(40);
const id = `sha256:${'1'.repeat(64)}`, reported = `sha256:${'2'.repeat(64)}`;

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'archive-reuse-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source');
  const archive = path.join(sourceDir, 'redis.tar.gz');
  execFileSync('mkdir', ['-p', sourceDir]);
  writeFileSync(archive, gzipSync(Buffer.alloc(2048)));
  const source = await recordDockerArchiveBuild({ revision: sourceRevision, runId: '100', attempt: 1, service: 'redis', image: 'alga-e2e-test-redis:latest',
    dockerfile: 'redis/Dockerfile', platform: 'linux/amd64', configImageId: id, buildReportedDigest: reported,
    metadata: { 'containerimage.config.digest': id, 'containerimage.digest': reported } }, archive, path.join(sourceDir, 'redis-build.json'));
  const zip = (name, files) => { const out = path.join(root, `${name}.zip`); execFileSync('zip', ['-q', '-j', out, ...files]); return out; };
  const zips = { record: zip('record', [path.join(sourceDir, 'redis-build.json')]), image: zip('image', [archive]) };
  const calls = [];
  const api = {
    listRuns: async branch => { calls.push(['runs', branch]); return branch === 'main' ? [{ id: '100', headSha: sourceRevision, createdAt: '2026-09-20T10:00:00Z', status: 'completed' }] : [{ id: '200', headSha: candidateRevision, createdAt: '2026-09-20T12:00:00Z', status: 'completed' }]; },
    listArtifacts: async runId => { calls.push(['artifacts', runId]); return runId === '100'
      ? [{ id: 'a1', name: 'fresh-install-build-record-redis', expired: false }, { id: 'a2', name: 'fresh-install-image-redis', expired: false }]
      : [{ id: 'a3', name: 'fresh-install-build-record-redis', expired: true }]; },
    downloadArtifact: async (artifactId, destination) => { calls.push(['download', artifactId]); execFileSync('cp', [artifactId === 'a1' ? zips.record : zips.image, destination]); },
  };
  const hashes = { [sourceRevision]: { sha256: `sha256:${'e'.repeat(64)}`, files: 4 }, [candidateRevision]: { sha256: `sha256:${'e'.repeat(64)}`, files: 4 } };
  return { root, source, api, calls, hashes, archivePath: path.join(root, 'out', 'redis.tar.gz'), recordPath: path.join(root, 'out', 'redis-build.json') };
}

const candidate = { revision: candidateRevision, runId: '200', attempt: 1 };
const args = f => ({ api: f.api, inputsHash: revision => f.hashes[revision], ensureCommit: () => {}, service: 'redis', image: 'alga-e2e-test-redis:latest',
  dockerfile: 'redis/Dockerfile', artifactName: 'fresh-install-image-redis', candidate, branches: ['feature/x', 'main'], archivePath: f.archivePath, recordPath: f.recordPath });

test('source runs are newest first, completed, deduplicated and never the current run', () => {
  const runs = orderSourceRuns([[{ id: '3', createdAt: '2026-01-03', status: 'completed' }, { id: '2', createdAt: '2026-01-02', status: 'in_progress' }],
    [{ id: '3', createdAt: '2026-01-03', status: 'completed' }, { id: '1', createdAt: '2026-01-01', status: 'completed' }, { id: '9', createdAt: '2026-01-09', status: 'completed' }]], '9');
  assert.deepEqual(runs.map(run => run.id), ['3', '1']);
});

test('an identical-input build is fetched, verified against its own record, and re-recorded for the candidate with reuse provenance', async (t) => {
  const f = await fixture(t);
  execFileSync('mkdir', ['-p', path.dirname(f.archivePath)]);
  const result = await findReusableBuild(args(f));
  assert.equal(result.reused, true);
  const record = JSON.parse(readFileSync(f.recordPath, 'utf8'));
  assert.equal(record.revision, candidateRevision);
  assert.equal(record.build.runId, '200');
  assert.deepEqual(record.reuse, { sourceRevision, sourceRunId: '100', sourceAttempt: 1, artifactRunId: '100', inputs: { policy: 'scripts/image-inputs.json', sha256: `sha256:${'e'.repeat(64)}`, files: 4 } });
  assert.equal(record.archive.sha256, f.source.archive.sha256);
  const expected = { revision: candidateRevision, runId: '200', attempt: 1, service: 'redis' };
  await verifyDockerArchive(record, f.archivePath, expected);
  verifyLoadedDockerImage(record, [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': sourceRevision } } }], expected);
  assert.throws(() => verifyLoadedDockerImage(record, [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': candidateRevision } } }], expected), /does not match/);
  assert.deepEqual(f.calls.filter(c => c[0] === 'download').map(c => c[1]), ['a1', 'a2'], 'the image is only downloaded after the record proves identical inputs');
});

test('different inputs, a different dockerfile, or tampered archive bytes all mean build it', async (t) => {
  for (const [name, mutate] of [
    ['inputs differ', f => { f.hashes[candidateRevision] = { sha256: `sha256:${'f'.repeat(64)}`, files: 4 }; }],
    ['dockerfile differs', f => { f.dockerfile = 'redis/Dockerfile.other'; }],
    ['archive tampered', f => { const original = f.api.downloadArtifact; f.api.downloadArtifact = async (id, dest) => { await original(id, dest); if (id === 'a2') { const bad = path.join(f.root, 'bad'); execFileSync('mkdir', ['-p', bad]); writeFileSync(path.join(bad, 'redis.tar.gz'), gzipSync(Buffer.alloc(2048, 1))); execFileSync('zip', ['-q', '-j', dest, path.join(bad, 'redis.tar.gz')]); } }; }],
  ]) {
    const f = await fixture(t);
    execFileSync('mkdir', ['-p', path.dirname(f.archivePath)]);
    mutate(f);
    const result = await findReusableBuild({ ...args(f), dockerfile: f.dockerfile ?? 'redis/Dockerfile' });
    assert.equal(result.reused, false, name);
    assert.equal(existsSync(f.recordPath), false, `${name}: no candidate record is written`);
    assert.equal(existsSync(f.archivePath), false, `${name}: no archive is left behind`);
  }
});

async function registryFixture(t, { kindOfSource = 'registry' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'registry-reuse-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source');
  execFileSync('mkdir', ['-p', sourceDir, path.join(root, 'out')]);
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { digest: id, size: 10 }, layers: [{ digest: `sha256:${'3'.repeat(64)}`, size: 20 }] }));
  const manifestDigest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`;
  const base = { revision: sourceRevision, runId: '100', attempt: 1, service: 'redis', image: 'alga-e2e-test-redis:latest', dockerfile: 'redis/Dockerfile',
    platform: 'linux/amd64', configImageId: id, buildReportedDigest: manifestDigest, metadata: { 'containerimage.config.digest': id, 'containerimage.digest': manifestDigest } };
  const reference = 'ghcr.io/nine-minds/alga-psa/e2e-redis';
  let source;
  if (kindOfSource === 'registry') {
    writeFileSync(path.join(sourceDir, 'manifest.json'), manifest);
    source = await recordDockerRegistryBuild({ ...base, registry: { reference, tag: 'run-100-1-' + sourceRevision } }, path.join(sourceDir, 'manifest.json'), path.join(sourceDir, 'redis-build.json'));
  } else {
    writeFileSync(path.join(sourceDir, 'redis.tar.gz'), gzipSync(Buffer.alloc(2048)));
    source = await recordDockerArchiveBuild({ ...base, buildReportedDigest: reported, metadata: { 'containerimage.config.digest': id, 'containerimage.digest': reported } }, path.join(sourceDir, 'redis.tar.gz'), path.join(sourceDir, 'redis-build.json'));
  }
  const zip = path.join(root, 'record.zip'); execFileSync('zip', ['-q', '-j', zip, path.join(sourceDir, 'redis-build.json')]);
  const calls = [];
  const api = {
    listRuns: async () => [{ id: '100', headSha: sourceRevision, createdAt: '2026-10-28T10:00:00Z', status: 'completed' }],
    listArtifacts: async () => [{ id: 'a1', name: 'fresh-install-build-record-redis', expired: false }],
    downloadArtifact: async (artifactId, destination) => { calls.push(['download', artifactId]); execFileSync('cp', [zip, destination]); },
  };
  const hashes = { [sourceRevision]: { sha256: `sha256:${'e'.repeat(64)}`, files: 4 }, [candidateRevision]: { sha256: `sha256:${'e'.repeat(64)}`, files: 4 } };
  const served = { [`${reference}@${manifestDigest}`]: manifest };
  return { root, source, api, calls, hashes, manifest, manifestDigest, reference, served,
    args: (extra = {}) => ({ api, inputsHash: revision => hashes[revision], ensureCommit: () => {}, service: 'redis', image: 'alga-e2e-test-redis:latest',
      dockerfile: 'redis/Dockerfile', artifactName: 'fresh-install-image-redis', candidate, branches: ['main'],
      archivePath: path.join(root, 'out', 'redis.tar.gz'), recordPath: path.join(root, 'out', 'redis-build.json'),
      transport: 'registry', registryNamespace: 'ghcr.io/nine-minds/alga-psa',
      inspectManifest: async (ref, digest) => { calls.push(['inspect', `${ref}@${digest}`]); const bytes = served[`${ref}@${digest}`]; if (!bytes) throw new Error('manifest unknown'); return bytes; }, ...extra }) };
}

test('on the registry transport a reused build re-records the manifest the registry still serves, moving no bytes', async (t) => {
  const f = await registryFixture(t);
  const result = await findReusableBuild(f.args());
  assert.equal(result.reused, true, JSON.stringify(result));
  const record = JSON.parse(readFileSync(path.join(f.root, 'out', 'redis-build.json'), 'utf8'));
  assert.equal(record.kind, 'docker-registry-build');
  assert.equal(record.revision, candidateRevision);
  assert.deepEqual(record.registry, f.source.registry);
  assert.equal(record.reuse.sourceRevision, sourceRevision);
  assert.equal(record.reuse.inputs.sha256, `sha256:${'e'.repeat(64)}`);
  assert.equal(existsSync(path.join(f.root, 'out', 'redis.tar.gz')), false, 'no archive is produced on the registry transport');
  assert.deepEqual(f.calls, [['download', 'a1'], ['inspect', `${f.reference}@${f.manifestDigest}`]]);
});

test('registry reuse refuses a manifest the registry no longer serves, a foreign namespace, or a source on the other transport', async (t) => {
  const gone = await registryFixture(t);
  delete gone.served[`${gone.reference}@${gone.manifestDigest}`];
  assert.equal((await findReusableBuild(gone.args())).reused, false);
  assert.equal(existsSync(path.join(gone.root, 'out', 'redis-build.json')), false);
  const foreign = await registryFixture(t);
  assert.equal((await findReusableBuild(foreign.args({ registryNamespace: 'ghcr.io/someone-else/alga-psa' }))).reused, false);
  const archiveSource = await registryFixture(t, { kindOfSource: 'artifact' });
  const result = await findReusableBuild(archiveSource.args());
  assert.equal(result.reused, false);
  assert.equal(archiveSource.calls.filter(c => c[0] === 'inspect').length, 0, 'a source built for the artifact transport is skipped before any registry inspection');
  await assert.rejects(findReusableBuild(archiveSource.args({ transport: 'carrier-pigeon' })), /Unknown image transport/);
});
