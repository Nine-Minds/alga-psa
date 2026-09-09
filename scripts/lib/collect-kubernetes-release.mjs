import { execFileSync } from 'node:child_process';
import { kubernetesReleaseObservations } from './kubernetes-release-observations.mjs';
const kinds = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Pod', 'Job']);
const dnsName = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;

export function collectKubernetesRelease(target, { execute = execFileSync } = {}) {
  if (typeof target?.context !== 'string' || !target.context.trim() || !dnsName.test(target?.namespace ?? '')
    || !Array.isArray(target.workloads) || !target.workloads.length) throw new Error('Explicit context, namespace and workloads are required');
  const seen = new Set();
  for (const workload of target.workloads) {
    if (!kinds.has(workload?.kind) || !dnsName.test(workload?.name ?? '') || seen.has(`${workload.kind}/${workload.name}`)) throw new Error('Unsupported, invalid or duplicate target workload');
    seen.add(`${workload.kind}/${workload.name}`);
  }
  const observedAt = new Date().toISOString();
  const read = args => JSON.parse(execute('kubectl', [`--context=${target.context}`, `--namespace=${target.namespace}`,
    'get', ...args, '-o', 'json'], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }));
  const workloads = target.workloads.map(expected => {
    const actual = read([expected.kind, expected.name]);
    if (actual.kind !== expected.kind || actual.metadata?.name !== expected.name || actual.metadata?.namespace !== target.namespace) throw new Error('Kubernetes returned a different target workload');
    return actual;
  });
  const inventory = read(['pods,replicasets']);
  if (inventory.kind !== 'List' || !Array.isArray(inventory.items) || inventory.metadata?.continue) throw new Error('Incomplete Kubernetes runtime inventory');
  if (inventory.items.some(item => !['Pod', 'ReplicaSet'].includes(item?.kind) || item.metadata?.namespace !== target.namespace)) throw new Error('Unexpected runtime inventory scope');
  const observations = kubernetesReleaseObservations({ workloads,
    pods: inventory.items.filter(item => item.kind === 'Pod'), replicaSets: inventory.items.filter(item => item.kind === 'ReplicaSet') });
  return { schemaVersion: 1, scope: 'kubernetes-runtime-image-observations', observedAt,
    target: { context: target.context, namespace: target.namespace, workloads: target.workloads }, observations };
}
