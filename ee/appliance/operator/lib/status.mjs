import { readReleaseManifest } from './releases.mjs';
import { ShellRunner } from './runner.mjs';

const PSA_COMPONENTS = [
  { name: 'alga-core', kind: 'deployment', resource: 'alga-core-sebastian' },
  { name: 'db', kind: 'statefulset', resource: 'db' },
  { name: 'redis', kind: 'statefulset', resource: 'redis' },
  { name: 'pgbouncer', kind: 'deployment', resource: 'pgbouncer' },
  { name: 'temporal', kind: 'deployment', resource: 'temporal' },
  { name: 'workflow-worker', kind: 'deployment', resource: 'workflow-worker' },
  { name: 'email-service', kind: 'deployment', resource: 'email-service' },
  { name: 'temporal-worker', kind: 'deployment', resource: 'temporal-worker' },
];

function parseJsonOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function readinessStatus(ready, total) {
  if (total === 0) {
    return 'unknown';
  }
  if (ready >= total) {
    return 'healthy';
  }
  if (ready > 0) {
    return 'degraded';
  }
  return 'unhealthy';
}

async function kubeJson(shell, kubeconfig, namespace, resource) {
  const args = ['--kubeconfig', kubeconfig];
  if (namespace) {
    args.push('-n', namespace);
  }
  args.push('get', resource, '-o', 'json');
  const result = await shell.runCapture('kubectl', args);
  return {
    ok: result.ok,
    code: result.code,
    output: result.output,
    json: result.ok ? parseJsonOutput(result.output) : null,
  };
}

function summarizeNodeReadiness(nodesJson) {
  const items = nodesJson?.items ?? [];
  return items.map((item) => {
    const readyCondition = (item.status?.conditions || []).find((entry) => entry.type === 'Ready');
    return {
      name: item.metadata?.name || 'unknown',
      ready: readyCondition?.status === 'True',
      status: readyCondition?.status || 'Unknown',
      message: readyCondition?.message || '',
    };
  });
}

function summarizeResourceReadiness(kind, item) {
  if (!item) {
    return { status: 'unknown', ready: 0, total: 0 };
  }
  if (kind === 'deployment') {
    const desired = item.spec?.replicas ?? 1;
    const ready = item.status?.readyReplicas ?? 0;
    return { status: readinessStatus(ready, desired), ready, total: desired };
  }
  if (kind === 'statefulset') {
    const desired = item.spec?.replicas ?? 1;
    const ready = item.status?.readyReplicas ?? 0;
    return { status: readinessStatus(ready, desired), ready, total: desired };
  }
  return { status: 'unknown', ready: 0, total: 0 };
}

function summarizeFluxItems(items) {
  return (items || []).map((item) => {
    const conditions = item.status?.conditions || [];
    const ready = conditions.find((entry) => entry.type === 'Ready');
    return {
      name: item.metadata?.name || 'unknown',
      ready: ready?.status === 'True',
      status: ready?.status || 'Unknown',
      message: ready?.message || '',
    };
  });
}

function mapRollupStatus(list, emptyStatus = 'unknown') {
  if (!list || list.length === 0) {
    return emptyStatus;
  }
  if (list.some((entry) => entry.status === 'unhealthy' || entry.status === 'False')) {
    return 'unhealthy';
  }
  if (list.some((entry) => entry.status === 'degraded' || entry.status === 'Unknown' || entry.status === 'False')) {
    return 'degraded';
  }
  if (list.every((entry) => entry.ready === true || entry.status === 'healthy' || entry.status === 'True')) {
    return 'healthy';
  }
  return 'degraded';
}

function parseAppUrlFromAlgaCoreConfigMap(configMapJson) {
  const data = configMapJson?.data || {};
  for (const value of Object.values(data)) {
    const text = String(value);
    const match = text.match(/appUrl:\s*["']?([^\n"']+)/);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

function parseDesiredAlgaCoreImages(configMapJson) {
  const data = configMapJson?.data || {};
  for (const value of Object.values(data)) {
    const text = String(value);
    const setupName = text.match(/setup:\n(?:.*\n)*?\s+image:\n(?:.*\n)*?\s+name:\s*([^\n]+)/m);
    const setupTag = text.match(/setup:\n(?:.*\n)*?\s+image:\n(?:.*\n)*?\s+tag:\s*"?([^\n"]+)"?/m);
    const serverName = text.match(/server:\n(?:.*\n)*?\s+image:\n(?:.*\n)*?\s+name:\s*([^\n]+)/m);
    const serverTag = text.match(/server:\n(?:.*\n)*?\s+image:\n(?:.*\n)*?\s+tag:\s*"?([^\n"]+)"?/m);

    return {
      setupImage: setupName && setupTag ? `${setupName[1].trim()}:${setupTag[1].trim()}` : null,
      serverImage: serverName && serverTag ? `${serverName[1].trim()}:${serverTag[1].trim()}` : null,
    };
  }
  return { setupImage: null, serverImage: null };
}

function parseActualAlgaCoreImages(deploymentJson) {
  return {
    setupImage: deploymentJson?.spec?.template?.spec?.initContainers?.[0]?.image || null,
    serverImage: deploymentJson?.spec?.template?.spec?.containers?.[0]?.image || null,
  };
}

function determineConnectivity(status) {
  if (status.cluster.apiReachable && status.workloads.status === 'healthy') {
    return 'app-healthy';
  }
  if (status.cluster.apiReachable) {
    return 'kubernetes-available';
  }
  if (status.host.status === 'healthy') {
    return 'talos-only';
  }
  return 'degraded';
}

function determineTopBlocker(status) {
  if (status.host.status === 'unreachable') {
    return {
      layer: 'Talos host reachability',
      reason: 'Talos API is unreachable',
      nextAction: 'Verify node IP, talosconfig, and network reachability.',
    };
  }

  if (!status.cluster.apiReachable) {
    return {
      layer: 'Kubernetes availability',
      reason: 'Kubernetes API is unavailable',
      nextAction: 'Check Talos control plane health and kubeconfig context.',
    };
  }

  if (status.flux.status !== 'healthy') {
    return {
      layer: 'Flux source/reconcile failure',
      reason: 'One or more Flux resources are not Ready',
      nextAction: 'Review Flux GitRepository and Kustomization conditions.',
    };
  }

  if (status.release.imageDrift?.detected) {
    return {
      layer: 'release drift',
      reason: 'Desired alga-core image differs from the live deployment image',
      nextAction: 'Run Repair Release to clean up alga-core workloads and reconcile the HelmRelease.',
    };
  }

  if (status.flux.helmStatus !== 'healthy') {
    return {
      layer: 'Helm release failure',
      reason: 'One or more appliance HelmRelease objects are not Ready',
      nextAction: 'Inspect HelmRelease status and reconcile events.',
    };
  }

  if (status.workloads.status !== 'healthy') {
    return {
      layer: 'workload readiness failure',
      reason: 'At least one PSA workload is not healthy',
      nextAction: 'Check workload pods and recent events, then collect a support bundle.',
    };
  }

  return {
    layer: 'none',
    reason: 'No blocker detected',
    nextAction: 'No immediate action required.',
  };
}

export async function collectStatus(env, options = {}) {
  const shell = options.runner || new ShellRunner({ cwd: env.runtime.assetRoot });
  const kubeconfig = options.kubeconfig || env.paths.kubeconfig;
  const talosconfig = options.talosconfig || env.paths.talosconfig;
  const nodeIp = options.nodeIp || env.nodeIp;

  const host = {
    status: 'unknown',
    details: '',
  };

  if (talosconfig && nodeIp) {
    const talosResult = await shell.runCapture('talosctl', [
      '--talosconfig',
      talosconfig,
      '-n',
      nodeIp,
      '-e',
      nodeIp,
      'health',
      '--wait-timeout',
      '20s',
    ]);
    if (talosResult.ok) {
      host.status = 'healthy';
      host.details = 'Talos API reachable';
    } else {
      host.status = 'unreachable';
      host.details = 'Talos health check failed';
    }
  }

  const apiResult = await shell.runCapture('kubectl', ['--kubeconfig', kubeconfig, 'get', '--raw=/readyz']);
  const cluster = {
    apiReachable: apiResult.ok,
    status: apiResult.ok ? 'healthy' : 'unavailable',
    nodeReadiness: [],
  };

  if (apiResult.ok) {
    const nodes = await kubeJson(shell, kubeconfig, null, 'nodes');
    cluster.nodeReadiness = summarizeNodeReadiness(nodes.json);
    cluster.status = mapRollupStatus(
      cluster.nodeReadiness.map((node) => ({
        status: node.ready ? 'healthy' : 'unhealthy',
      })),
      'healthy',
    );
  }

  const flux = {
    status: cluster.apiReachable ? 'unknown' : 'unavailable',
    helmStatus: cluster.apiReachable ? 'unknown' : 'unavailable',
    sources: [],
    kustomizations: [],
    helmReleases: [],
  };

  if (cluster.apiReachable) {
    const sources = await kubeJson(shell, kubeconfig, 'flux-system', 'gitrepositories.source.toolkit.fluxcd.io');
    const kustomizations = await kubeJson(shell, kubeconfig, 'flux-system', 'kustomizations.kustomize.toolkit.fluxcd.io');
    const helmReleases = await kubeJson(shell, kubeconfig, 'alga-system', 'helmreleases.helm.toolkit.fluxcd.io');

    flux.sources = summarizeFluxItems(sources.json?.items);
    flux.kustomizations = summarizeFluxItems(kustomizations.json?.items);
    flux.helmReleases = summarizeFluxItems(helmReleases.json?.items);
    flux.status = mapRollupStatus([...flux.sources, ...flux.kustomizations], 'unknown');
    flux.helmStatus = mapRollupStatus(flux.helmReleases, 'unknown');
  }

  const workloads = {
    status: cluster.apiReachable ? 'unknown' : 'unavailable',
    components: [],
  };

  if (cluster.apiReachable) {
    for (const component of PSA_COMPONENTS) {
      const resource = `${component.kind}/${component.resource}`;
      const fetched = await kubeJson(shell, kubeconfig, 'msp', resource);
      const readiness = summarizeResourceReadiness(component.kind, fetched.json);
      workloads.components.push({
        name: component.name,
        kind: component.kind,
        namespace: 'msp',
        ready: `${readiness.ready}/${readiness.total}`,
        status: readiness.status,
        message: fetched.ok ? '' : 'Resource not found or unavailable',
      });
    }
    workloads.status = mapRollupStatus(workloads.components, 'unknown');
  }

  const release = {
    selectedReleaseVersion: null,
    metadata: null,
    appUrl: env.appUrl,
    desiredImages: {
      setupImage: null,
      serverImage: null,
    },
    actualImages: {
      setupImage: null,
      serverImage: null,
    },
    imageDrift: {
      detected: false,
    },
  };

  if (cluster.apiReachable) {
    const selection = await kubeJson(shell, kubeconfig, 'alga-system', 'configmap/appliance-release-selection');
    release.selectedReleaseVersion = selection.json?.data?.releaseVersion || null;

    const values = await kubeJson(shell, kubeconfig, 'alga-system', 'configmap/appliance-values-alga-core');
    const parsedAppUrl = parseAppUrlFromAlgaCoreConfigMap(values.json);
    release.desiredImages = parseDesiredAlgaCoreImages(values.json);
    if (parsedAppUrl) {
      release.appUrl = parsedAppUrl;
    }

    const algaCoreDeployment = await kubeJson(shell, kubeconfig, 'msp', 'deployment/alga-core-sebastian');
    release.actualImages = parseActualAlgaCoreImages(algaCoreDeployment.json);
    release.imageDrift = {
      detected:
        !!release.desiredImages.serverImage &&
        !!release.actualImages.serverImage &&
        (release.desiredImages.serverImage !== release.actualImages.serverImage ||
          (release.desiredImages.setupImage &&
            release.actualImages.setupImage &&
            release.desiredImages.setupImage !== release.actualImages.setupImage)),
    };
  }

  if (release.selectedReleaseVersion) {
    try {
      release.metadata = readReleaseManifest(env.runtime.releasesDir, release.selectedReleaseVersion);
    } catch {
      release.metadata = null;
    }
  }

  const status = {
    timestamp: new Date().toISOString(),
    siteId: env.site.siteId,
    nodeIp,
    configPaths: {
      configDir: env.site.configDir,
      kubeconfig,
      talosconfig,
    },
    host,
    cluster,
    flux,
    workloads,
    release,
  };

  status.connectivityMode = determineConnectivity(status);
  status.topBlocker = determineTopBlocker(status);
  return status;
}
