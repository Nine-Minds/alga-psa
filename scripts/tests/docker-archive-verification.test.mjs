import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
import { verifyDockerArchive, verifyLoadedDockerImage } from '../verify-docker-archive-build.mjs';
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'server.tar.gz');
  await writeFile(archive, gzipSync(Buffer.alloc(1024)));
  const expected = { revision: 'a'.repeat(40), runId: '123', attempt: 2, service: 'server' };
  const id = `sha256:${'1'.repeat(64)}`, reported = `sha256:${'2'.repeat(64)}`;
  const record = await recordDockerArchiveBuild({ ...expected, image: 'candidate:latest', dockerfile: 'Dockerfile.build',
    platform: 'linux/amd64', configImageId: id, buildReportedDigest: reported,
    metadata: { 'containerimage.config.digest': id, 'containerimage.digest': reported } }, archive, path.join(root, 'record.json'));
  const inspection = [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': expected.revision } } }];
  return { archive, expected, record, inspection };
}
test('accepts the producer record, exact archive bytes and loaded candidate identity', async t => {
  const f = await fixture(t);
  await verifyDockerArchive(f.record, f.archive, f.expected);
  verifyLoadedDockerImage(f.record, f.inspection, f.expected);
});
for (const [name, change] of [
  ['revision', r => { r.revision = 'b'.repeat(40); }],
  ['run', r => { r.build.runId = '124'; }],
  ['future attempt', r => { r.build.attempt = 3; }],
  ['invalid attempt', r => { r.build.attempt = 0; }],
  ['service', r => { r.service = 'server-ee'; }],
  ['metadata', r => { r.metadata['containerimage.config.digest'] = r.buildReportedDigest; }],
]) test(`rejects a different ${name} before accepting either artifact`, async t => {
  const f = await fixture(t); change(f.record);
  await assert.rejects(verifyDockerArchive(f.record, f.archive, f.expected));
  assert.throws(() => verifyLoadedDockerImage(f.record, f.inspection, f.expected));
});
test('rejects modified compressed bytes even when their size is unchanged', async t => {
  const f = await fixture(t);
  await writeFile(f.archive, Buffer.alloc(f.record.archive.bytes));
  await assert.rejects(verifyDockerArchive(f.record, f.archive, f.expected), /bytes differ/);
});
for (const [name, change] of [
  ['image identity', i => { i[0].Id = `sha256:${'3'.repeat(64)}`; }],
  ['revision label', i => { delete i[0].Config.Labels['org.opencontainers.image.revision']; }],
  ['architecture', i => { i[0].Architecture = 'arm64'; }],
  ['empty inspection', i => { i.length = 0; }],
]) test(`rejects loaded ${name} mismatch`, async t => {
  const f = await fixture(t); change(f.inspection);
  assert.throws(() => verifyLoadedDockerImage(f.record, f.inspection, f.expected));
});

test('accepts an earlier successful build attempt in the same run and revision', async t => {
  const f = await fixture(t); f.record.build.attempt = 1;
  await verifyDockerArchive(f.record, f.archive, f.expected);
  verifyLoadedDockerImage(f.record, f.inspection, f.expected);
});
