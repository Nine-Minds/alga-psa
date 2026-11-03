import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { callbackRuntimeBinding, callbackComposeOverride } from '../run-microsoft-callback-ci.mjs';
import { verifyMicrosoftCallbackEvidence } from '../lib/microsoft-callback-evidence.mjs';
import { DEVELOPMENT_RUNTIME_COMPOSE_FILE, DEVELOPMENT_RUNTIME_IMAGE, DEVELOPMENT_RUNTIME_WORKSPACE_TARGET } from '../lib/development-runtime.mjs';
const revision = 'a'.repeat(40), root = '/workspace';
const image = { reference: DEVELOPMENT_RUNTIME_IMAGE, id: `sha256:${'b'.repeat(64)}` };
const validContainer = () => ({ Image: image.id, Mounts: [{ Type: 'bind', Source: root, Destination: DEVELOPMENT_RUNTIME_WORKSPACE_TARGET, RW: true }] });

test('the inspected checkout mount binds the development runtime container to this checkout', () => {
  assert.deepEqual(callbackRuntimeBinding({ image, container: validContainer(), root, revision }), {
    runtimeImage: DEVELOPMENT_RUNTIME_IMAGE, imageId: image.id, containerImageId: image.id, mountedSourceRevision: revision, workspaceMounted: true,
  });
});
for (const [name, mutate] of [
  ['another checkout', c => { c.Mounts[0].Source = '/another'; }],
  ['missing checkout', c => { c.Mounts.pop(); }],
  ['volume rather than bind', c => { c.Mounts[0].Type = 'volume'; }],
  ['duplicate mount target', c => { c.Mounts.push({ ...c.Mounts[0] }); }],
]) test(`rejects ${name} as the checkout binding`, () => {
  const container = validContainer(); mutate(container);
  assert.equal(callbackRuntimeBinding({ image, container, root, revision }).workspaceMounted, false);
});
test('changed container image remains visible to independent evidence validation', () => {
  const container = validContainer(); container.Image = `sha256:${'c'.repeat(64)}`;
  const runtimeBinding = callbackRuntimeBinding({ image, container, root, revision });
  const evidence = verifyMicrosoftCallbackEvidence({ revision, runtimeBinding, report: { sourceRevisionOrigin: 'environment', sourceRevision: revision, sourceRevisionAfter: null } });
  assert.ok(evidence.failures.includes('mismatched-callback-source'));
});
test('the compose override leaves the image to the development runtime file and keeps writable compilation mounts', () => {
  const { services: { server } } = callbackComposeOverride({ root, temporary: '/tmp/callback', output: '/results', revision, sourceEmail: 'synthetic@example.invalid' });
  assert.equal(server.build, undefined);
  assert.equal(server.image, undefined, 'the development runtime compose file names the image');
  assert.equal(server.environment.DB_HOST, server.environment.NATIVE_MICROSOFT_OIDC_EXPECTED_DB_HOST);
  assert.equal(server.environment.DB_NAME_SERVER, server.environment.NATIVE_MICROSOFT_OIDC_EXPECTED_DB_NAME);
  assert.equal(server.environment.E2E_TEST_REVISION, revision);
  assert.equal(server.environment.NATIVE_MICROSOFT_OIDC_SOURCE_EMAIL, 'synthetic@example.invalid');
  for (const target of ['/callback-output', '/app/server/.next/microsoft-oidc-callback', '/app/server/node_modules/.cache/webpack']) assert.ok(server.volumes.find(v => v.target === target && v.read_only !== true));
  assert.equal(server.volumes.find(v => v.target === DEVELOPMENT_RUNTIME_WORKSPACE_TARGET), undefined, 'the checkout mount belongs to the development runtime file');
  // A mount point directly under the mounted checkout would be materialised
  // there as an untracked path and fail the wrapper's clean-source check.
  assert.ok(server.volumes.every(v => !/^\/app\/[^/]+$/.test(v.target)), 'nothing is mounted directly under the checkout');
});
test('the development runtime compose file mounts the checkout into the pinned image', () => {
  const compose = yaml.load(readFileSync(DEVELOPMENT_RUNTIME_COMPOSE_FILE, 'utf8'));
  assert.equal(compose.services.server.image, DEVELOPMENT_RUNTIME_IMAGE);
  assert.equal(compose.services.server.user, '0:0');
  const mount = compose.services.server.volumes.find(v => v.target === DEVELOPMENT_RUNTIME_WORKSPACE_TARGET);
  assert.equal(mount.type, 'bind');
  assert.match(mount.source, /^\$\{E2E_DEVELOPMENT_WORKSPACE:\?/);
});
