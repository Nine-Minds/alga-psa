import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'build-record-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'server.tar.gz'), output = path.join(root, 'record.json');
  const bytes = gzipSync(Buffer.alloc(1024)); // Empty tar terminator.
  await writeFile(archive, bytes);
  const configImageId = `sha256:${'1'.repeat(64)}`, buildReportedDigest = `sha256:${'2'.repeat(64)}`;
  return { archive, output, bytes, input: { revision: 'a'.repeat(40), runId: '123', attempt: 2,
    service: 'server-ee', image: 'candidate-ee:latest', dockerfile: 'ee/server/Dockerfile.build', platform: 'linux/amd64',
    configImageId, buildReportedDigest, metadata: { 'containerimage.config.digest': configImageId,
      'containerimage.digest': buildReportedDigest, buildargs: { password: 'must-never-appear' } } } };
}
test('records actual compressed bytes and separates image config from reported digest without claiming publication', async t => {
  const f = await fixture(t); const record = await recordDockerArchiveBuild(f.input, f.archive, f.output);
  assert.equal(record.archive.sha256, `sha256:${createHash('sha256').update(f.bytes).digest('hex')}`);
  assert.equal(record.archive.bytes, f.bytes.length);
  assert.equal(record.kind, 'docker-archive-build'); assert.equal(record.registryPublication, false);
  assert.notEqual(record.configImageId, record.buildReportedDigest);
  assert.deepEqual(record.metadata, { 'containerimage.config.digest': f.input.configImageId, 'containerimage.digest': f.input.buildReportedDigest });
  assert.deepEqual(JSON.parse(await readFile(f.output, 'utf8')), record);
});
for (const [name, mutate] of [
  ['missing config ID', x => delete x.configImageId], ['wrong revision', x => { x.revision = 'main'; }],
  ['wrong run', x => { x.runId = 'unknown'; }], ['missing attempt', x => delete x.attempt],
  ['metadata mismatch', x => { x.metadata['containerimage.digest'] = x.configImageId; }],
  ['invalid metadata', x => { x.metadata = '{bad'; }], ['missing Dockerfile', x => delete x.dockerfile],
]) test(`rejects ${name} and clears stale output`, async t => {
  const f = await fixture(t); await writeFile(f.output, 'stale'); mutate(f.input);
  await assert.rejects(recordDockerArchiveBuild(f.input, f.archive, f.output));
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});
test('rejects missing, empty, and corrupted gzip archives and clears stale output', async t => {
  const f = await fixture(t);
  for (const bytes of [null, Buffer.alloc(0), Buffer.from([0x1f, 0x8b, 0, 0])]) {
    if (bytes === null) await rm(f.archive); else await writeFile(f.archive, bytes);
    await writeFile(f.output, 'stale');
    await assert.rejects(recordDockerArchiveBuild(f.input, f.archive, f.output));
    await assert.rejects(readFile(f.output), { code: 'ENOENT' });
  }
});
