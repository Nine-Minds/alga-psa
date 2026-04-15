export function printSection(title, lines = []) {
  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`${'-'.repeat(title.length)}\n`);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

export function formatStatusSummary(status) {
  if (!status) {
    return [
      'Site: unknown',
      'Node IP: unknown',
      'Connectivity: unknown',
      'Selected release: unknown',
    ];
  }

  const lines = [
    `Site: ${status.siteId}`,
    `Node IP: ${status.nodeIp || 'unknown'}`,
    `Connectivity: ${status.connectivityMode}`,
    `Selected release: ${status.release.selectedReleaseVersion || 'unknown'}`,
  ];
  return lines;
}

export function formatStatusReport(status) {
  if (!status) {
    return {
      summary: [
        'Site: unknown',
        'Node IP: unknown',
        'Connectivity: unknown',
        'Top blocker: status unavailable',
        'Blocker detail: Unable to collect appliance status yet.',
        'Next action: Verify site selection and cluster connectivity, then refresh status.',
      ],
      host: [
        'Status: unknown',
        'Detail: Talos status not collected',
      ],
      cluster: [
        'API reachable: false',
        'Status: unavailable',
      ],
      flux: [
        'Flux status: unavailable',
        'Helm status: unavailable',
      ],
      workloads: [
        'Workload status: unavailable',
      ],
      release: [
        'Selected release: unknown',
        'App URL: unknown',
        'Release app version: unknown',
        'Release branch: unknown',
        'Desired server image: unknown',
        'Actual server image: unknown',
      ],
      paths: [
        'Config dir: unknown',
        'kubeconfig: unknown',
        'talosconfig: unknown',
      ],
    };
  }

  return {
    summary: [
      `Site: ${status.siteId}`,
      `Node IP: ${status.nodeIp || 'unknown'}`,
      `Connectivity: ${status.connectivityMode}`,
      `Top blocker: ${status.topBlocker.layer}`,
      `Blocker detail: ${status.topBlocker.reason}`,
      `Next action: ${status.topBlocker.nextAction}`,
    ],
    host: [
      `Status: ${status.host.status}`,
      `Detail: ${status.host.details || 'n/a'}`,
    ],
    cluster: [
      `API reachable: ${status.cluster.apiReachable}`,
      `Status: ${status.cluster.status}`,
      ...status.cluster.nodeReadiness.map((node) =>
        `Node ${node.name}: ${node.ready ? 'Ready' : 'NotReady'} ${node.message || ''}`.trim(),
      ),
    ],
    flux: [
      `Flux status: ${status.flux.status}`,
      `Helm status: ${status.flux.helmStatus}`,
      ...status.flux.sources.map((entry) => `GitRepository ${entry.name}: ${entry.status}`),
      ...status.flux.kustomizations.map((entry) => `Kustomization ${entry.name}: ${entry.status}`),
      ...status.flux.helmReleases.map((entry) => `HelmRelease ${entry.name}: ${entry.status}`),
    ],
    workloads: [
      `Workload status: ${status.workloads.status}`,
      ...status.workloads.components.map((entry) =>
        `${entry.name}: ${entry.status} (${entry.ready})${entry.message ? ` - ${entry.message}` : ''}`,
      ),
    ],
    release: [
      `Selected release: ${status.release.selectedReleaseVersion || 'unknown'}`,
      `App URL: ${status.release.appUrl || 'unknown'}`,
      `Release app version: ${status.release.metadata?.app?.version || 'unknown'}`,
      `Release branch: ${status.release.metadata?.app?.releaseBranch || 'unknown'}`,
      `Desired server image: ${status.release.desiredImages?.serverImage || 'unknown'}`,
      `Actual server image: ${status.release.actualImages?.serverImage || 'unknown'}`,
      ...(status.release.imageDrift?.detected ? ['Release drift: desired and actual alga-core images differ'] : []),
    ],
    paths: [
      `Config dir: ${status.configPaths.configDir}`,
      `kubeconfig: ${status.configPaths.kubeconfig}`,
      `talosconfig: ${status.configPaths.talosconfig}`,
    ],
  };
}
