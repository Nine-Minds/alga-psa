import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { recordDockerRegistryBuild } from '../record-docker-registry-build.mjs';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
import { verifyPulledDockerImage, verifyLoadedDockerImage, verifyRegistryManifest } from '../verify-docker-archive-build.mjs';
import { browserArtifactServices, createBrowserRegistryReceipt, createBrowserArchiveReceipt, buildBrowserArtifactManifest,
  validateBrowserArtifactManifest } from '../lib/browser-artifact-manifest.mjs';

const sha = buffer => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
const configImageId = `sha256:${'1'.repeat(64)}`;
const namespace = 'ghcr.io/nine-minds/alga-psa';
function manifestBytes(overrides = {}) {
  return Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: configImageId, size: 1234 },
    layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: `sha256:${'a'.repeat(64)}`, size: 5 }], ...overrides }));
}
async function fixture(t, service = 'server-ee') {
  const root = await mkdtemp(path.join(tmpdir(), 'registry-record-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = manifestBytes(), manifestDigest = sha(bytes);
  const manifest = path.join(root, `${service}-manifest.json`), output = path.join(root, `${service}-build.json`);
  await writeFile(manifest, bytes);
  const input = { revision: 'a'.repeat(40), runId: '123', attempt: 2, service, image: 'alga-e2e-test_server_ee_local:latest',
    dockerfile: 'ee/server/Dockerfile.build', platform: 'linux/amd64', configImageId, buildReportedDigest: manifestDigest,
    metadata: { 'containerimage.config.digest': configImageId, 'containerimage.digest': manifestDigest, 'image.name': 'x', buildargs: { password: 'must-never-appear' } },
    registry: { reference: `${namespace}/e2e-${service}`, tag: `run-123-2-${'a'.repeat(40)}` } };
  const inspection = [{ Id: configImageId, Os: 'linux', Architecture: 'amd64', RepoDigests: [`${namespace}/e2e-${service}@${manifestDigest}`],
    Config: { Labels: { 'org.opencontainers.image.revision': input.revision }, Env: ['SECRET=do-not-export'] } }];
  return { root, bytes, manifestDigest, manifest, output, input, inspection,
    expected: { revision: input.revision, runId: '123', attempt: 2, service, registryNamespace: namespace } };
}

test('records the registry manifest the build reported and binds it to the image config', async t => {
  const f = await fixture(t);
  const record = await recordDockerRegistryBuild(f.input, f.manifest, f.output);
  assert.equal(record.kind, 'docker-registry-build'); assert.equal(record.registryPublication, false);
  assert.deepEqual(record.registry, { reference: `${namespace}/e2e-server-ee`, tag: f.input.registry.tag, manifestDigest: f.manifestDigest,
    mediaType: 'application/vnd.oci.image.manifest.v1+json', bytes: f.bytes.length });
  assert.equal(record.archive, undefined);
  assert.equal(JSON.stringify(record).includes('must-never-appear'), false);
  assert.deepEqual(JSON.parse(await readFile(f.output, 'utf8')), record);
});
test('tolerates exactly one trailing newline appended by the manifest printer', async t => {
  const f = await fixture(t);
  await writeFile(f.manifest, Buffer.concat([f.bytes, Buffer.from('\n')]));
  const record = await recordDockerRegistryBuild(f.input, f.manifest, f.output);
  assert.equal(record.registry.bytes, f.bytes.length);
  assert.throws(() => verifyRegistryManifest(Buffer.concat([f.bytes, Buffer.from('\n\n')]), { manifestDigest: f.manifestDigest, configImageId }), /bytes differ/);
});
for (const [name, damage] of [
  ['altered manifest bytes', f => writeFile(f.manifest, Buffer.from(f.bytes.toString().replace('1234', '1235')))],
  ['manifest for another config', async f => { const bytes = manifestBytes({ config: { digest: `sha256:${'9'.repeat(64)}`, size: 1 } }); f.input.buildReportedDigest = f.input.metadata['containerimage.digest'] = sha(bytes); await writeFile(f.manifest, bytes); }],
  ['image index instead of a manifest', async f => { const bytes = manifestBytes({ mediaType: 'application/vnd.oci.image.index.v1+json' }); f.input.buildReportedDigest = f.input.metadata['containerimage.digest'] = sha(bytes); await writeFile(f.manifest, bytes); }],
  ['manifest without layers', async f => { const bytes = manifestBytes({ layers: [] }); f.input.buildReportedDigest = f.input.metadata['containerimage.digest'] = sha(bytes); await writeFile(f.manifest, bytes); }],
  ['missing manifest', f => rm(f.manifest)],
  ['uppercase reference', f => { f.input.registry.reference = 'ghcr.io/Nine-Minds/alga-psa/e2e-server-ee'; }],
  ['reference carrying a tag', f => { f.input.registry.reference = `${namespace}/e2e-server-ee:latest`; }],
  ['missing tag', f => { delete f.input.registry.tag; }],
  ['wrong revision', f => { f.input.revision = 'main'; }],
  ['metadata disagreeing with outputs', f => { f.input.metadata['containerimage.digest'] = configImageId; }],
]) test(`rejects ${name} and clears stale output`, async t => {
  const f = await fixture(t); await writeFile(f.output, 'stale'); await damage(f);
  await assert.rejects(recordDockerRegistryBuild(f.input, f.manifest, f.output));
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});
test('CLI records from the build environment and removes stale output on failure', async t => {
  const f = await fixture(t), cli = path.resolve('scripts/record-docker-registry-build.mjs');
  const env = { ...process.env, GITHUB_SHA: f.input.revision, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', BUILD_SERVICE: 'server-ee',
    BUILD_IMAGE: f.input.image, BUILD_DOCKERFILE: f.input.dockerfile, BUILD_PLATFORM: 'linux/amd64', BUILD_CONFIG_IMAGE_ID: configImageId,
    BUILD_REPORTED_DIGEST: f.manifestDigest, BUILD_METADATA: JSON.stringify(f.input.metadata),
    BUILD_REGISTRY_REFERENCE: f.input.registry.reference, BUILD_REGISTRY_TAG: f.input.registry.tag };
  assert.equal(spawnSync(process.execPath, [cli, f.manifest, f.output], { env }).status, 0);
  assert.equal(JSON.parse(await readFile(f.output, 'utf8')).registry.manifestDigest, f.manifestDigest);
  const failed = spawnSync(process.execPath, [cli, f.manifest, f.output], { env: { ...env, BUILD_REGISTRY_REFERENCE: 'docker.io/library/alpine' }, encoding: 'utf8' });
  assert.equal(failed.status, 0, 'any lowercase repository reference is a valid record; the consumer enforces the namespace');
  const broken = spawnSync(process.execPath, [cli, f.manifest, f.output], { env: { ...env, BUILD_REPORTED_DIGEST: configImageId, BUILD_METADATA: JSON.stringify({ ...f.input.metadata, 'containerimage.digest': configImageId }) }, encoding: 'utf8' });
  assert.equal(broken.status, 1); assert.equal(broken.stderr.trim(), 'Docker registry build record failed validation or recording');
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});

test('a pulled image must carry the recorded repository digest from the candidate namespace', async t => {
  const f = await fixture(t);
  const record = await recordDockerRegistryBuild(f.input, f.manifest, f.output);
  assert.equal(verifyPulledDockerImage(record, f.inspection, f.expected), `${namespace}/e2e-server-ee@${f.manifestDigest}`);
  verifyLoadedDockerImage(record, f.inspection, f.expected);
  for (const [name, change] of [
    ['no repository digest', i => { delete i[0].RepoDigests; }],
    ['another repository digest', i => { i[0].RepoDigests = [`${namespace}/e2e-server-ee@sha256:${'f'.repeat(64)}`]; }],
    ['another image config', i => { i[0].Id = `sha256:${'f'.repeat(64)}`; }],
  ]) {
    const inspection = structuredClone(f.inspection); change(inspection);
    assert.throws(() => verifyPulledDockerImage(record, inspection, f.expected), undefined, name);
  }
  assert.throws(() => verifyPulledDockerImage(record, f.inspection, { ...f.expected, registryNamespace: 'ghcr.io/someone-else/alga-psa' }), /outside the candidate namespace/);
  assert.throws(() => verifyPulledDockerImage({ ...record, kind: 'docker-archive-build' }, f.inspection, f.expected));
});

async function registryComponents(t, edition) {
  const context = { revision: 'a'.repeat(40), edition, runId: '123', runAttempt: 2 };
  const components = [];
  for (const service of browserArtifactServices(edition)) {
    const f = await fixture(t, service);
    const record = await recordDockerRegistryBuild(f.input, f.manifest, f.output);
    const receipt = createBrowserRegistryReceipt(record, f.inspection, { ...context, registryNamespace: namespace });
    assert.equal(receipt.kind, 'browser-ci-registry-verification');
    components.push({ record, receipt, inspection: f.inspection });
  }
  return { context, components };
}
for (const edition of ['community', 'enterprise']) test(`${edition} manifest of pulled registry images validates and sanitizes inspections`, async t => {
  const { context, components } = await registryComponents(t, edition);
  const manifest = buildBrowserArtifactManifest({ ...context, components });
  assert.equal(manifest.kind, 'browser-ci-registry-images'); assert.equal(manifest.scope, 'candidate-pulled-registry-images-only');
  assert.equal(manifest.registryPublication, false);
  assert.equal(manifest.components.length, edition === 'enterprise' ? 9 : 8);
  assert.equal(JSON.stringify(manifest).includes('do-not-export'), false);
  assert.ok(manifest.components.every(component => component.inspection[0].RepoDigests.length === 1));
  assert.deepEqual(validateBrowserArtifactManifest(manifest, context), manifest);
  assert.throws(() => validateBrowserArtifactManifest({ ...manifest, kind: 'browser-ci-docker-archives', scope: 'candidate-built-archives-only' }, context));
});
test('manifest rejects a wrong receipt kind, a missing pull digest and mixed transports', async t => {
  const { context, components } = await registryComponents(t, 'community');
  const build = () => buildBrowserArtifactManifest({ ...context, components: structuredClone(components) });
  assert.doesNotThrow(build);
  const wrongReceipt = structuredClone(components); wrongReceipt[0].receipt.kind = 'browser-ci-archive-verification';
  assert.throws(() => buildBrowserArtifactManifest({ ...context, components: wrongReceipt }));
  const unpulled = structuredClone(components); delete unpulled[0].inspection[0].RepoDigests;
  assert.throws(() => buildBrowserArtifactManifest({ ...context, components: unpulled }));
  const root = await mkdtemp(path.join(tmpdir(), 'mixed-transport-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'redis.tar.gz'); await writeFile(archive, gzipSync(Buffer.alloc(1024)));
  const id = `sha256:${'2'.repeat(64)}`, reported = `sha256:${'3'.repeat(64)}`;
  const record = await recordDockerArchiveBuild({ ...context, attempt: 2, service: 'redis', image: 'alga-e2e-test-redis:latest', dockerfile: 'redis/Dockerfile',
    platform: 'linux/amd64', configImageId: id, buildReportedDigest: reported, metadata: { 'containerimage.config.digest': id, 'containerimage.digest': reported } },
  archive, path.join(root, 'redis.json'));
  const receipt = await createBrowserArchiveReceipt(record, archive, context);
  const mixed = components.map(component => component.record.service === 'redis' ? { record, receipt,
    inspection: [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': context.revision } } }] } : component);
  assert.throws(() => buildBrowserArtifactManifest({ ...context, components: mixed }), /share one transport/);
});
test('CLI registry mode writes a receipt from a pulled inspection and enforces the namespace', async t => {
  const f = await fixture(t), cli = path.resolve('scripts/browser-artifact-manifest.mjs');
  await recordDockerRegistryBuild(f.input, f.manifest, f.output);
  const inspection = path.join(f.root, 'pulled.json'), receipt = path.join(f.root, 'receipt.json');
  await writeFile(inspection, JSON.stringify(f.inspection));
  const env = { ...process.env, GITHUB_SHA: f.input.revision, E2E_EDITION: 'enterprise', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', E2E_REGISTRY_NAMESPACE: namespace };
  assert.equal(spawnSync(process.execPath, [cli, 'registry', inspection, receipt, f.output, 'server-ee'], { env }).status, 0);
  assert.equal(JSON.parse(await readFile(receipt, 'utf8')).kind, 'browser-ci-registry-verification');
  const outside = spawnSync(process.execPath, [cli, 'registry', inspection, receipt, f.output, 'server-ee'], { env: { ...env, E2E_REGISTRY_NAMESPACE: 'ghcr.io/other/repo' }, encoding: 'utf8' });
  assert.equal(outside.status, 1); await assert.rejects(readFile(receipt), { code: 'ENOENT' });
});
