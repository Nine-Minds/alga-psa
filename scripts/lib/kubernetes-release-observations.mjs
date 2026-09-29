import { renderedReleaseComponents } from './rendered-release-components.mjs';

const pullableImage = /^[^@\s:]+(?::[0-9]+)?\/[^@\s]+@sha256:[a-f0-9]{64}$/;
const supported = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Pod', 'Job']);
const controller = (child, parent) => typeof parent.metadata?.uid === 'string' && parent.metadata.uid.length > 0
  && child.metadata?.namespace === parent.metadata?.namespace
  && child.metadata?.ownerReferences?.some(owner => owner.controller === true && owner.kind === parent.kind
    && owner.uid === parent.metadata.uid && owner.name === parent.metadata.name);

// Inputs must be live API snapshots, not rendered desired manifests. UID chains
// associate pods with workloads; labels alone cannot establish ownership.
// Runtime-specific bare image/config IDs require a separate resolver. Never
// manufacture pullable digest evidence from PodSpec.image or status.image.
export function kubernetesReleaseObservations({ workloads, pods, replicaSets = [] }) {
  if (!Array.isArray(workloads) || !workloads.length || !Array.isArray(pods) || !Array.isArray(replicaSets)) throw new Error('Missing live Kubernetes inventories');
  if (pods.some(pod => pod?.kind !== 'Pod') || replicaSets.some(set => set?.kind !== 'ReplicaSet')) throw new Error('Wrong runtime inventory kinds');
  const components = renderedReleaseComponents(workloads);
  const observations = [];
  for (const workload of workloads) {
    const { kind, metadata, spec, status } = workload;
    if (!supported.has(kind)) throw new Error(`Unsupported runtime workload: ${kind}`);
    if (!metadata?.uid || !metadata.namespace || metadata.deletionTimestamp) throw new Error('Workload lacks live identity or is terminating');
    let owned;
    if (kind === 'Pod') owned = pods.filter(pod => pod.metadata?.uid === metadata.uid && pod.metadata?.namespace === metadata.namespace);
    else if (kind === 'Deployment') {
      const sets = replicaSets.filter(set => controller(set, workload));
      owned = pods.filter(pod => sets.some(set => controller(pod, set)));
    } else owned = pods.filter(pod => controller(pod, workload));
    const desired = kind === 'Pod' ? 1 : kind === 'DaemonSet' ? status?.desiredNumberScheduled
      : kind === 'Job' ? spec?.completions ?? 1 : spec?.replicas ?? 1;
    if (!Number.isSafeInteger(desired) || desired <= 0 || owned.length !== desired) throw new Error(`${kind}/${metadata.name}: missing replicas or rollout still in progress`);
    if (!['Pod', 'Job'].includes(kind) && (!Number.isSafeInteger(metadata.generation) || metadata.generation <= 0
      || !Number.isSafeInteger(status?.observedGeneration) || status.observedGeneration < metadata.generation)) throw new Error(`${kind}/${metadata.name}: stale controller status`);
    const jobComplete = kind === 'Job';
    if (jobComplete && !status?.conditions?.some(condition => condition.type === 'Complete' && condition.status === 'True')) throw new Error(`Job/${metadata.name}: completion not observed`);
    const template = kind === 'Pod' ? spec : spec.template.spec;
    const expected = components.filter(component => component.name.startsWith(`${metadata.namespace}/${kind}/${metadata.name}/`));
    const images = new Map(expected.map(component => [component.name, new Set()]));
    const seenPods = new Set();
    for (const pod of owned) {
      if (!pod.metadata?.uid || seenPods.has(pod.metadata.uid)) throw new Error('Duplicate or missing pod UID');
      seenPods.add(pod.metadata.uid);
      if (pod.metadata.deletionTimestamp || pod.status?.phase !== (jobComplete ? 'Succeeded' : 'Running')) throw new Error(`${metadata.name}: pod is not in its required runtime state`);
      if (!jobComplete && !pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')) throw new Error(`${metadata.name}: pod is not ready`);
      if (pod.spec?.ephemeralContainers?.length) throw new Error('Ephemeral containers require explicit release validation');
      for (const group of ['containers', 'initContainers']) {
        const declarations = template[group] ?? [];
        const actual = pod.spec?.[group] ?? [];
        const statuses = pod.status?.[group === 'containers' ? 'containerStatuses' : 'initContainerStatuses'] ?? [];
        if (!Array.isArray(actual) || !Array.isArray(statuses) || actual.length !== declarations.length || statuses.length !== declarations.length
          || new Set(actual.map(container => container.name)).size !== actual.length
          || new Set(statuses.map(container => container.name)).size !== statuses.length) throw new Error(`${metadata.name}: missing or unexpected ${group}`);
        for (const declaration of declarations) {
          const running = actual.find(container => container.name === declaration.name);
          const state = statuses.find(container => container.name === declaration.name);
          if (!running || !state) throw new Error(`${metadata.name}: missing container ${declaration.name}`);
          const needsTermination = jobComplete || (group === 'initContainers' && declaration.restartPolicy !== 'Always');
          if (needsTermination ? state.state?.terminated?.exitCode !== 0 : !state.state?.running || state.ready !== true) throw new Error(`${metadata.name}/${declaration.name}: container is not ready or completed successfully`);
          const image = typeof state.imageID === 'string' ? state.imageID.replace(/^docker-pullable:\/\//, '') : '';
          if (!pullableImage.test(image)) throw new Error(`${metadata.name}/${declaration.name}: runtime imageID is not a supported pullable digest`);
          images.get(`${metadata.namespace}/${kind}/${metadata.name}/${group}/${declaration.name}`).add(image);
        }
      }
    }
    for (const [name, observed] of images) {
      if (observed.size !== 1) throw new Error(`${name}: mixed runtime image identities`);
      observations.push({ name, image: [...observed][0] });
    }
  }
  return observations.sort((a, b) => a.name.localeCompare(b.name));
}
