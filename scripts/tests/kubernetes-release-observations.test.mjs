import test from 'node:test';
import assert from 'node:assert/strict';
import { kubernetesReleaseObservations } from '../lib/kubernetes-release-observations.mjs';
import { compareReleaseDeployment } from '../lib/release-component-manifest.mjs';
const image = name => `registry.example.test/${name}@sha256:${'a'.repeat(64)}`;
const owner = resource => ({ kind: resource.kind, name: resource.metadata.name, uid: resource.metadata.uid, controller: true });
function fixture(kind = 'Deployment') {
  const containers = [{ name: 'app', image: 'registry.example.test/app:mutable-desired-tag' }];
  const initContainers = [{ name: 'setup', image: 'registry.example.test/setup:mutable-desired-tag' }];
  const workload = { kind, metadata: { namespace: 'isolated', name: 'service', uid: 'workload-uid', generation: 3 },
    spec: { replicas: 2, completions: 2, template: { spec: { containers, initContainers } } },
    status: { observedGeneration: 3, desiredNumberScheduled: 2, conditions: [{ type: 'Complete', status: 'True' }] } };
  const rs = { kind: 'ReplicaSet', metadata: { namespace: 'isolated', name: 'service-rs', uid: 'rs-uid', ownerReferences: [owner(workload)] } };
  const pods = [0, 1].map(index => ({ kind: 'Pod', metadata: { namespace: 'isolated', name: `pod-${index}`, uid: `pod-uid-${index}`, ownerReferences: [owner(kind === 'Deployment' ? rs : workload)] },
    spec: structuredClone({ containers, initContainers }), status: { phase: kind === 'Job' ? 'Succeeded' : 'Running', conditions: [{ type: 'Ready', status: 'True' }],
      containerStatuses: [{ name: 'app', ready: true, state: kind === 'Job' ? { terminated: { exitCode: 0 } } : { running: {} }, imageID: `docker-pullable://${image('app')}` }],
      initContainerStatuses: [{ name: 'setup', state: { terminated: { exitCode: 0 } }, imageID: image('setup') }] } }));
  return { workloads: [workload], pods, replicaSets: [rs] };
}
for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job']) {
  test(`reads ${kind} runtime digests and successful init containers through UID ownership`, () => {
    const input = fixture(kind), observations = kubernetesReleaseObservations(input);
    assert.deepEqual(observations, ['containers/app', 'initContainers/setup'].map(suffix => ({ name: `isolated/${kind}/service/${suffix}`, image: image(suffix.split('/')[1]) })));
    const manifest = { schemaVersion: 1, revision: 'a'.repeat(40), edition: 'enterprise', components: observations };
    assert.equal(compareReleaseDeployment({ manifest, revision: manifest.revision, edition: manifest.edition, requiredComponents: observations.map(item => item.name), observations }).status, 'passed');
  });
}
for (const [name, mutate] of [
  ['missing replica', x => x.pods.pop()],
  ['stale controller', x => { x.workloads[0].status.observedGeneration--; }],
  ['wrong owner UID', x => { x.replicaSets[0].metadata.ownerReferences[0].uid = 'old-workload'; }],
  ['wrong namespace', x => { x.pods[0].metadata.namespace = 'other'; }],
  ['unready pod', x => { x.pods[0].status.conditions[0].status = 'False'; }],
  ['terminating pod', x => { x.pods[0].metadata.deletionTimestamp = '2026-09-01T00:00:00Z'; }],
  ['missing runtime image ID', x => { delete x.pods[0].status.containerStatuses[0].imageID; }],
  ['bare config ID', x => { x.pods[0].status.containerStatuses[0].imageID = `containerd://sha256:${'a'.repeat(64)}`; }],
  ['mixed rollout', x => { x.pods[0].status.containerStatuses[0].imageID = image('different'); }],
  ['failed init', x => { x.pods[0].status.initContainerStatuses[0].state.terminated.exitCode = 1; }],
  ['unexpected sidecar', x => { x.pods[0].spec.containers.push({ name: 'extra', image: image('extra') }); }],
  ['duplicate pod', x => { x.pods[1] = structuredClone(x.pods[0]); }],
  ['duplicate status', x => { x.pods[0].status.containerStatuses.push(x.pods[0].status.containerStatuses[0]); }],
  ['unsupported operator', x => { x.workloads[0].kind = 'CustomWorkload'; }],
]) test(`rejects ${name} rather than reporting desired-image evidence`, () => {
  const input = fixture(); mutate(input); assert.throws(() => kubernetesReleaseObservations(input));
});

test('matching desired image cannot conceal a consistently substituted runtime digest', () => {
  const input = fixture();
  const expected = kubernetesReleaseObservations(input);
  for (const pod of input.pods) pod.status.containerStatuses[0].imageID = image('replacement');
  const observations = kubernetesReleaseObservations(input);
  const manifest = { schemaVersion: 1, revision: 'a'.repeat(40), edition: 'enterprise', components: expected };
  assert.equal(compareReleaseDeployment({ manifest, revision: manifest.revision, edition: manifest.edition, requiredComponents: expected.map(item => item.name), observations }).status, 'failed');
});

test('collector pins kubectl reads to explicit targets and never substitutes desired image fields', async () => {
  const { collectKubernetesRelease } = await import('../lib/collect-kubernetes-release.mjs');
  const input = fixture(); const calls = [];
  const target = { context: 'test-context', namespace: 'isolated', workloads: [{ kind: 'Deployment', name: 'service' }] };
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return JSON.stringify(args.includes('pods,replicasets') ? { kind: 'List', items: [...input.pods, ...input.replicaSets] } : input.workloads[0]);
  };
  assert.deepEqual(collectKubernetesRelease(target, { execute }).observations, kubernetesReleaseObservations(input));
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, 'kubectl');
    assert.deepEqual(call.args.slice(0, 3), ['--context=test-context', '--namespace=isolated', 'get']);
    assert.equal(call.options.timeout, 30000);
  }
  assert.throws(() => collectKubernetesRelease({ ...target, context: '' }, { execute }), /Explicit/);
  assert.equal(calls.length, 2);
  assert.throws(() => collectKubernetesRelease(target, { execute: () => '{truncated' }));
  input.workloads[0].metadata.namespace = 'other';
  assert.throws(() => collectKubernetesRelease(target, { execute }), /different target/);
});

test('native sidecar init containers require running readiness instead of a fabricated successful exit', () => {
  const input = fixture(); input.workloads[0].spec.template.spec.initContainers[0].restartPolicy = 'Always';
  assert.throws(() => kubernetesReleaseObservations(input), /not ready/);
  for (const pod of input.pods) {
    pod.spec.initContainers[0].restartPolicy = 'Always';
    pod.status.initContainerStatuses[0].state = { running: {} };
    pod.status.initContainerStatuses[0].ready = true;
  }
  assert.equal(kubernetesReleaseObservations(input).length, 2);
});

test('direct Pod observations still require the live UID and successful init status', () => {
  const pod = fixture().pods[0];
  const input = { workloads: [pod], pods: [structuredClone(pod)] };
  assert.equal(kubernetesReleaseObservations(input).length, 2);
  input.pods[0].metadata.uid = 'different-pod';
  assert.throws(() => kubernetesReleaseObservations(input), /missing replicas/);
});

test('missing ReplicaSet UID and incomplete Jobs cannot provide release observations', () => {
  const input = fixture(); delete input.replicaSets[0].metadata.uid;
  for (const pod of input.pods) delete pod.metadata.ownerReferences[0].uid;
  assert.throws(() => kubernetesReleaseObservations(input), /missing replicas/);
  const job = fixture('Job'); job.workloads[0].status.conditions = [];
  assert.throws(() => kubernetesReleaseObservations(job), /completion not observed/);
});

test('collector envelope flows into promotion with target and freshness policy intact', async () => {
  const { collectKubernetesRelease } = await import('../lib/collect-kubernetes-release.mjs');
  const { releaseManifestDigest, verifyReleasePromotion } = await import('../lib/release-test-evidence.mjs');
  const input = fixture();
  const expectedTarget = { context: 'release-smoke', namespace: 'isolated', workloads: [{ kind: 'Deployment', name: 'service' }] };
  const runtimeEvidence = collectKubernetesRelease(expectedTarget, { execute: (_command, args) => JSON.stringify(
    args.includes('pods,replicasets') ? { kind: 'List', items: [...input.pods, ...input.replicaSets] } : input.workloads[0]) });
  const revision = 'a'.repeat(40), edition = 'enterprise';
  const manifest = { schemaVersion: 1, revision, edition, components: kubernetesReleaseObservations(input).map(component => ({ ...component, revision, build: { provider: 'host-fixture', runId: 1 } })) };
  const policy = { revision, edition, manifest, expectedTarget, maxObservationAgeSeconds: 300,
    requiredComponents: manifest.components.map(component => component.name), requiredChecks: ['smoke'] };
  const manifestDigest = releaseManifestDigest(policy);
  const evidence = { schemaVersion: 1, revision, edition, manifestDigest,
    results: [{ id: 'smoke', status: 'passed', failures: [], manifestDigest }] };
  const serialized = JSON.parse(JSON.stringify(runtimeEvidence));
  assert.equal(verifyReleasePromotion({ ...policy, evidence, runtimeEvidence: serialized }).status, 'passed');
  serialized.target.namespace = 'other';
  assert.equal(verifyReleasePromotion({ ...policy, evidence, runtimeEvidence: serialized }).status, 'failed');
});
