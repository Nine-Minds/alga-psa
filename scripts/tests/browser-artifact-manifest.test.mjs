import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
import { browserArtifactServices, createBrowserArchiveReceipt, buildBrowserArtifactManifest,
  validateBrowserArtifactManifest } from '../lib/browser-artifact-manifest.mjs';
const context = { revision: 'a'.repeat(40), edition: 'community', runId: '12345', runAttempt: 2 };
async function fixture(t, edition = 'community') {
  const directory = await mkdtemp(path.join(tmpdir(), 'browser-artifacts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expected = { ...context, edition };
  const components = [];
  for (const service of browserArtifactServices(edition)) {
    const archivePath = path.join(directory, `${service}.tar.gz`);
    await writeFile(archivePath, gzipSync(`synthetic archive bytes for ${service}`));
    const configImageId = `sha256:${'b'.repeat(64)}`, buildReportedDigest = `sha256:${'c'.repeat(64)}`;
    const record = await recordDockerArchiveBuild({ ...expected, attempt: 1, service, image: `candidate-${service}:test`,
      dockerfile: 'Dockerfile', platform: 'linux/amd64', configImageId, buildReportedDigest,
      metadata: { 'containerimage.config.digest': configImageId, 'containerimage.digest': buildReportedDigest } },
    archivePath, path.join(directory, `${service}.json`));
    const receipt = await createBrowserArchiveReceipt(record, archivePath, expected);
    components.push({ record, receipt, inspection: [{ Id: configImageId, Os: 'linux', Architecture: 'amd64',
      Config: { Labels: { 'org.opencontainers.image.revision': expected.revision }, Env: ['SECRET=do-not-export'] } }] });
  }
  return { directory, expected, components };
}
for (const edition of ['community', 'enterprise']) test(`${edition} binds exact loaded archives after gzip removal and sanitizes inspection`, async t => {
  const f = await fixture(t, edition);
  for (const component of f.components) await rm(path.join(f.directory, component.record.archive.filename));
  const manifest = buildBrowserArtifactManifest({ ...f.expected, components: f.components });
  assert.equal(manifest.registryPublication, false);
  assert.equal(manifest.scope, 'candidate-built-archives-only');
  assert.equal(manifest.components.length, edition === 'enterprise' ? 9 : 8);
  assert.equal(JSON.stringify(manifest).includes('do-not-export'), false);
  assert.deepEqual(validateBrowserArtifactManifest(manifest, f.expected), manifest);
  assert.equal(manifest.components[0].record.build.attempt, 1, 'earlier successful build attempt remains explicit');
  assert.equal(manifest.runAttempt, 2);
});
// Helpers take context at the top level, avoiding accidental fixture-only fields.
function build(f) { return buildBrowserArtifactManifest({ ...f.expected, components: f.components }); }
for (const [name, mutate] of [
  ['omitted component', f => f.components.pop()],
  ['duplicate component', f => f.components.push(f.components[0])],
  ['wrong edition server', f => { f.expected.edition = 'enterprise'; }],
  ['changed archive hash', f => { f.components[0].record.archive.sha256 = `sha256:${'d'.repeat(64)}`; }],
  ['wrong receipt attempt', f => { f.components[0].receipt.runAttempt = 1; }],
  ['wrong receipt run', f => { f.components[0].receipt.runId = '54321'; }],
  ['wrong receipt revision', f => { f.components[0].receipt.revision = 'd'.repeat(40); }],
  ['wrong loaded image', f => { f.components[0].inspection[0].Id = `sha256:${'d'.repeat(64)}`; }],
  ['wrong loaded platform', f => { f.components[0].inspection[0].Architecture = 'arm64'; }],
  ['wrong loaded revision', f => { f.components[0].inspection[0].Config.Labels['org.opencontainers.image.revision'] = 'd'.repeat(40); }],
]) test(`rejects ${name}`, async t => { const f = await fixture(t); mutate(f); assert.throws(() => build(f)); });
test('receipt requires actual matching archive bytes', async t => {
  const f = await fixture(t), { record } = f.components[0];
  const archivePath = path.join(f.directory, record.archive.filename);
  const bytes = await readFile(archivePath); bytes[bytes.length - 1] ^= 1; await writeFile(archivePath, bytes);
  await assert.rejects(createBrowserArchiveReceipt(record, archivePath, f.expected), /bytes differ/);
});
test('validator rejects stale execution identity and registry claims', async t => {
  const f = await fixture(t), manifest = build(f);
  for (const expected of [{ ...f.expected, runAttempt: 3 }, { ...f.expected, runId: '9' }, { ...f.expected, revision: 'd'.repeat(40) }])
    assert.throws(() => validateBrowserArtifactManifest(manifest, expected));
  assert.throws(() => validateBrowserArtifactManifest({ ...manifest, registryPublication: true }, f.expected));
});
test('CLI creates receipt and manifest, then removes stale output on verification failure', async t => {
  const f = await fixture(t), cli = path.resolve('scripts/browser-artifact-manifest.mjs');
  const env = { ...process.env, GITHUB_SHA: context.revision, E2E_EDITION: context.edition,
    GITHUB_RUN_ID: context.runId, GITHUB_RUN_ATTEMPT: String(context.runAttempt) };
  const entries = [];
  for (const component of f.components) {
    const service = component.record.service, record = path.join(f.directory, `${service}.json`);
    const receipt = path.join(f.directory, `${service}-receipt.json`), inspection = path.join(f.directory, `${service}-loaded.json`);
    assert.equal(spawnSync(process.execPath, [cli, 'archive', path.join(f.directory, `${service}.tar.gz`), receipt, record, service], { env }).status, 0);
    await writeFile(inspection, JSON.stringify(component.inspection));
    entries.push({ record, receipt, inspection });
  }
  const input = path.join(f.directory, 'inputs.json'), output = path.join(f.directory, 'manifest.json');
  await writeFile(input, JSON.stringify(entries));
  assert.equal(spawnSync(process.execPath, [cli, 'manifest', input, output], { env }).status, 0);
  validateBrowserArtifactManifest(JSON.parse(await readFile(output)), f.expected);
  await writeFile(entries[0].receipt, '{}');
  const failed = spawnSync(process.execPath, [cli, 'manifest', input, output], { env, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(failed.stderr.trim(), 'Browser CI artifact evidence verification failed');
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});
test('CLI refuses output aliases without deleting record, receipt, inspection, or inputs', async t => {
  const f = await fixture(t), component = f.components[0];
  const paths = { record: path.join(f.directory, 'record.json'), receipt: path.join(f.directory, 'receipt.json'),
    inspection: path.join(f.directory, 'inspection.json') };
  for (const key of Object.keys(paths)) await writeFile(paths[key], JSON.stringify(component[key]));
  const input = path.join(f.directory, 'inputs.json'); await writeFile(input, JSON.stringify([paths]));
  for (const output of [...Object.values(paths), input]) {
    const before = await readFile(output, 'utf8');
    const result = spawnSync(process.execPath, [path.resolve('scripts/browser-artifact-manifest.mjs'), 'manifest', input, output], {
      env: { ...process.env, GITHUB_SHA: context.revision, E2E_EDITION: context.edition,
        GITHUB_RUN_ID: context.runId, GITHUB_RUN_ATTEMPT: '2' } });
    assert.equal(result.status, 1); assert.equal(await readFile(output, 'utf8'), before);
  }
});
test('failed archive receipt CLI removes stale receipt', async t => {
  const f = await fixture(t), service = f.components[0].record.service, output = path.join(f.directory, 'stale-receipt.json');
  await writeFile(output, JSON.stringify(f.components[0].receipt));
  const result = spawnSync(process.execPath, [path.resolve('scripts/browser-artifact-manifest.mjs'), 'archive',
    path.join(f.directory, 'missing.tar.gz'), output, path.join(f.directory, `${service}.json`), service], {
    env: { ...process.env, GITHUB_SHA: context.revision, E2E_EDITION: context.edition,
      GITHUB_RUN_ID: context.runId, GITHUB_RUN_ATTEMPT: '2' } });
  assert.equal(result.status, 1); await assert.rejects(readFile(output), { code: 'ENOENT' });
});
