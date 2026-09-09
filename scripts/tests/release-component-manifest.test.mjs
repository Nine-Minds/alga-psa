import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseManifest, compareReleaseDeployment } from '../lib/release-component-manifest.mjs';

const image = (name, digest = 'a') => `registry.example.test/alga/${name}@sha256:${digest.repeat(64)}`;
const fixture = () => ({
  revision: '1'.repeat(40), edition: 'enterprise', requiredComponents: ['server', 'email-service'],
  manifest: { schemaVersion: 1, revision: '1'.repeat(40), edition: 'enterprise',
    components: [{ name: 'server', image: image('server') }, { name: 'email-service', image: image('email-service', 'b') }] },
});

test('accepts complete immutable component identities in any order', () => {
  const input = fixture();
  input.manifest.components.reverse();
  assert.equal(validateReleaseManifest(input).status, 'passed');
  assert.equal(compareReleaseDeployment({ ...input, observations: [...input.manifest.components].reverse() }).status, 'passed');
});

test('rejects incomplete, duplicate, unknown and mutable release components', () => {
  for (const mutate of [
    x => { x.manifest.components.pop(); },
    x => { x.manifest.components.push(x.manifest.components[0]); },
    x => { x.manifest.components.push({ name: 'unreviewed', image: image('unreviewed') }); },
    x => { x.manifest.components[0].image = 'registry.example.test/alga/server:latest'; },
    x => { x.manifest.components[0].image = image('server').slice(0, -1); },
    x => { x.manifest.components[0].image = image('server') + '\n'; },
    x => { x.manifest.components = null; },
    x => { x.manifest.components = [null]; },
    x => { x.requiredComponents = []; },
    x => { x.requiredComponents.push('server'); },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(validateReleaseManifest(input).status, 'failed', JSON.stringify(input));
  }
});

test('rejects stale source, wrong edition and unsupported manifest schema', () => {
  for (const field of ['revision', 'edition', 'schemaVersion']) {
    const input = fixture(); input.manifest[field] = 'unexpected';
    assert.equal(validateReleaseManifest(input).status, 'failed');
  }
  assert.equal(validateReleaseManifest({ ...fixture(), revision: 'HEAD' }).status, 'failed');
  assert.equal(validateReleaseManifest({ ...fixture(), edition: 'unknown' }).status, 'failed');
});

test('rejects missing, substituted, mutable and duplicate deployment readbacks', () => {
  for (const observations of [undefined, [], [{ name: 'server', image: image('server') }],
    [{ name: 'server', image: image('server', 'c') }, { name: 'email-service', image: image('email-service', 'b') }],
    [{ name: 'server', image: 'registry.example.test/alga/server:latest' }],
    [{ name: 'server', image: image('server') }, { name: 'server', image: image('server') }],
    [{ name: 'unknown', image: image('unknown') }], [null]]) {
    assert.equal(compareReleaseDeployment({ ...fixture(), observations }).status, 'failed');
  }
  const input = fixture(); input.manifest.revision = '2'.repeat(40);
  assert.equal(compareReleaseDeployment({ ...input, observations: input.manifest.components }).status, 'failed');
});
