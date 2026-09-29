const nonWorkloads = new Set(['ConfigMap', 'Secret', 'Service', 'ServiceAccount', 'Role', 'RoleBinding',
  'ClusterRole', 'ClusterRoleBinding', 'Ingress', 'NetworkPolicy', 'PodDisruptionBudget',
  'HorizontalPodAutoscaler', 'PersistentVolumeClaim', 'PersistentVolume', 'StorageClass', 'Namespace']);
const identityPart = value => typeof value === 'string' && value.trim() === value && value.length && !value.includes('/');

// Consume the entire rendered release, including hooks and init containers.
// Unknown resource kinds need an explicit adapter rather than silently losing
// operator-managed workloads. No Secret/ConfigMap contents enter the result.
export function renderedReleaseComponents(resources, { defaultNamespace } = {}) {
  if (!Array.isArray(resources)) throw new Error('Expected rendered resource array');
  const components = [];
  const identities = new Set();
  function visit(resource) {
    if (!resource || typeof resource !== 'object') throw new Error('Invalid rendered resource');
    if (resource.kind === 'List') {
      if (!Array.isArray(resource.items)) throw new Error('Invalid rendered resource List');
      for (const item of resource.items) visit(item);
      return;
    }
    if (nonWorkloads.has(resource.kind)) return;
    let pod;
    switch (resource.kind) {
      case 'Pod': pod = resource.spec; break;
      case 'Deployment': case 'StatefulSet': case 'DaemonSet': case 'ReplicaSet': case 'Job':
        pod = resource.spec?.template?.spec; break;
      case 'CronJob': pod = resource.spec?.jobTemplate?.spec?.template?.spec; break;
      default: throw new Error(`Unsupported rendered resource kind: ${resource.kind}`);
    }
    const namespace = resource.metadata?.namespace ?? defaultNamespace;
    const workload = resource.metadata?.name;
    if (!identityPart(namespace) || !identityPart(workload)) throw new Error('Workload requires explicit namespace and name');
    if (!Array.isArray(pod?.containers) || !pod.containers.length) throw new Error(`Workload ${workload} has no containers`);
    if (pod.initContainers !== undefined && !Array.isArray(pod.initContainers)) throw new Error(`Invalid init containers: ${workload}`);
    if (pod.ephemeralContainers?.length) throw new Error(`Ephemeral containers require separate runtime verification: ${workload}`);
    for (const group of ['initContainers', 'containers']) {
      for (const container of pod[group] ?? []) {
        if (!identityPart(container?.name) || typeof container.image !== 'string' || !container.image.trim()) {
          throw new Error(`Container requires a name and image: ${workload}`);
        }
        const name = `${namespace}/${resource.kind}/${workload}/${group}/${container.name}`;
        if (identities.has(name)) throw new Error(`Duplicate rendered component: ${name}`);
        identities.add(name);
        components.push({ name, image: container.image });
      }
    }
  }
  for (const resource of resources) visit(resource);
  if (!components.length) throw new Error('Rendered release has no workload components');
  return components.sort((a, b) => a.name.localeCompare(b.name));
}
