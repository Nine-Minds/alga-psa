import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderedReleaseComponents } from '../lib/rendered-release-components.mjs';
import { validateReleaseManifest } from '../lib/release-component-manifest.mjs';

const pod = () => ({ containers: [{ name: 'server', image: `registry.test/server@sha256:${'a'.repeat(64)}` }],
  initContainers: [{ name: 'bootstrap', image: `registry.test/setup@sha256:${'b'.repeat(64)}` }] });
const deployment = () => ({ kind: 'Deployment', metadata: { name: 'alga', namespace: 'test' }, spec: { template: { spec: pod() } } });

test('derives required images from workload containers, init containers and hooks without copying secrets', () => {
  const hook = { kind: 'Job', metadata: { name: 'migration', namespace: 'test', annotations: { 'helm.sh/hook': 'pre-upgrade' } }, spec: { template: { spec: pod() } } };
  const components = renderedReleaseComponents([{ kind: 'Secret', data: { password: 'must-not-appear' } }, deployment(), { kind: 'List', items: [hook] }]);
  assert.deepEqual(components.map(x => x.name), ['test/Deployment/alga/containers/server', 'test/Deployment/alga/initContainers/bootstrap',
    'test/Job/migration/containers/server', 'test/Job/migration/initContainers/bootstrap']);
  assert.deepEqual(Object.keys(components[0]).sort(), ['image', 'name']);
  const input = { revision: '1'.repeat(40), edition: 'enterprise', requiredComponents: components.map(x => x.name),
    manifest: { schemaVersion: 1, revision: '1'.repeat(40), edition: 'enterprise', components } };
  assert.equal(validateReleaseManifest(input).status, 'passed');
  input.manifest.components = components.filter(x => !x.name.includes('/initContainers/'));
  assert.equal(validateReleaseManifest(input).status, 'failed');
});

test('supports explicit namespace fallback and scheduled workload templates', () => {
  const resources = [{ kind: 'CronJob', metadata: { name: 'scheduled' }, spec: { jobTemplate: { spec: { template: { spec: pod() } } } } },
    { kind: 'Pod', metadata: { name: 'one-off' }, spec: pod() }];
  assert.equal(renderedReleaseComponents(resources, { defaultNamespace: 'release' }).length, 4);
  assert.throws(() => renderedReleaseComponents(resources), /explicit namespace/);
});

test('rejects empty or unsupported releases and malformed or duplicate workload components', () => {
  for (const resources of [[], [null], [{ kind: 'UnknownOperatorCluster' }], [{ kind: 'List' }],
    [{ kind: 'ConfigMap', data: {} }], [deployment(), deployment()],
    [{ ...deployment(), spec: {} }],
    [{ ...deployment(), spec: { template: { spec: { containers: [{ name: 'server' }] } } } }]]) {
    assert.throws(() => renderedReleaseComponents(resources));
  }
});
