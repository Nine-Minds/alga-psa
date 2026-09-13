import test from 'node:test';
import assert from 'node:assert/strict';
import { callbackRuntimeBinding, callbackComposeOverride } from '../run-microsoft-callback-ci.mjs';
import { verifyMicrosoftCallbackEvidence } from '../lib/microsoft-callback-evidence.mjs';
const revision = 'a'.repeat(40), root = '/workspace';
const image = { id: `sha256:${'b'.repeat(64)}`, revision };
const validContainer = () => ({ Image: image.id, Mounts: ['packages', 'ee', 'e2e-tests'].map(part => ({ Type: 'bind', Source: `${root}/${part}`, Destination: `/app/${part}`, RW: false })) });
test('actual inspected read-only source mounts bind the container image to the checkout', () => {
  assert.deepEqual(callbackRuntimeBinding({ image, container: validContainer(), root, revision }), {
    imageRevision: revision, imageId: image.id, containerImageId: image.id, mountedSourceRevision: revision, mountsReadOnly: true,
  });
});
for (const [name, mutate] of [
  ['writable source', c => { c.Mounts[0].RW = true; }],
  ['another checkout', c => { c.Mounts[0].Source = '/another/packages'; }],
  ['missing source', c => { c.Mounts.pop(); }],
  ['volume rather than bind', c => { c.Mounts[0].Type = 'volume'; }],
  ['duplicate mount target', c => { c.Mounts.push({ ...c.Mounts[0] }); }],
]) test(`rejects ${name} as a read-only checkout binding`, () => {
  const container = validContainer(); mutate(container);
  assert.equal(callbackRuntimeBinding({ image, container, root, revision }).mountsReadOnly, false);
});
test('changed container image remains visible to independent evidence validation', () => {
  const container = validContainer(); container.Image = `sha256:${'c'.repeat(64)}`;
  const runtimeBinding = callbackRuntimeBinding({ image, container, root, revision });
  const evidence = verifyMicrosoftCallbackEvidence({ revision, runtimeBinding, report: { sourceRevisionOrigin: 'environment', sourceRevision: revision, sourceRevisionAfter: null } });
  assert.ok(evidence.failures.includes('mismatched-callback-source'));
});
test('compose fixture uses existing image, isolated services and writable compilation mounts', () => {
  const { services: { server } } = callbackComposeOverride({ root, temporary: '/tmp/callback', output: '/results', revision, sourceEmail: 'synthetic@example.invalid' });
  assert.equal(server.build, undefined);
  assert.equal(server.image, 'alga-e2e-test_server_ee_local:latest');
  assert.equal(server.environment.DB_HOST, server.environment.NATIVE_MICROSOFT_OIDC_EXPECTED_DB_HOST);
  assert.equal(server.environment.DB_NAME_SERVER, server.environment.NATIVE_MICROSOFT_OIDC_EXPECTED_DB_NAME);
  assert.equal(server.environment.E2E_TEST_REVISION, revision);
  assert.equal(server.environment.NATIVE_MICROSOFT_OIDC_SOURCE_EMAIL, 'synthetic@example.invalid');
  for (const part of ['packages', 'ee', 'e2e-tests']) assert.deepEqual(server.volumes.find(v => v.target === `/app/${part}`), { type: 'bind', source: `${root}/${part}`, target: `/app/${part}`, read_only: true });
  for (const target of ['/callback-output', '/app/server/.next/microsoft-oidc-callback', '/app/server/node_modules/.cache/webpack']) assert.ok(server.volumes.find(v => v.target === target && v.read_only !== true));
});
