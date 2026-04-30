import { readReleaseManifest } from './releases.mjs';
import { ShellRunner } from './runner.mjs';

const PSA_COMPONENTS = [
  { name: 'alga-core', kind: 'deployment', resource: 'alga-core-sebastian', tier: 'login' },
  { name: 'db', kind: 'statefulset', resource: 'db', tier: 'core' },
  { name: 'redis', kind: 'statefulset', resource: 'redis', tier: 'core' },
  { name: 'pgbouncer', kind: 'deployment', resource: 'pgbouncer', tier: 'core' },
  { name: 'temporal', kind: 'deployment', resource: 'temporal', tier: 'background' },
  { name: 'workflow-worker', kind: 'deployment', resource: 'workflow-worker', tier: 'background' },
  { name: 'email-service', kind: 'deployment', resource: 'email-service', tier: 'background' },
  { name: 'temporal-worker', kind: 'deployment', resource: 'temporal-worker', tier: 'background' },
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

function detectDnsFailure(status) {
  const signals = [
    status.host.details,
    status.cluster.apiError,
    ...(status.recentEvents || []).map((entry) => entry.message),
    ...(status.flux.sources || []).map((entry) => entry.message),
    ...(status.flux.kustomizations || []).map((entry) => entry.message),
    ...(status.flux.helmReleases || []).map((entry) => entry.message),
    ...(status.workloads.components || []).map((entry) => entry.message),
  ]
    .filter(Boolean)
    .map((value) => String(value));

  return signals.find((value) => /\blookup\b/i.test(value) && /\b(connection refused|no such host|server misbehaving|i\/o timeout)\b/i.test(value));
}

function detectPostgresSubPathFailure(status) {
  const messages = (status.recentEvents || []).map((entry) => String(entry.message || ''));
  return messages.find((value) => /failed to create subpath directory/i.test(value) || /volumemount "db-data"/i.test(value));
}

function inferComponentFromObjectName(name) {
  const value = String(name || '').toLowerCase();
  if (value.includes('workflow-worker')) return 'workflow-worker';
  if (value.includes('temporal-worker')) return 'temporal-worker';
  if (value.includes('email-service')) return 'email-service';
  if (value.includes('temporal')) return 'temporal';
  if (value.includes('alga-core-sebastian') || value.includes('alga-core')) return 'alga-core';
  return null;
}

function detectMissingImageTag(status) {
  const events = status.recentEvents || [];
  const match = events.find((entry) => {
    const message = String(entry.message || '');
    return /imagepullbackoff|failed to pull image|errimagepull/i.test(message) && /not found/i.test(message);
  });
  if (!match) {
    return null;
  }

  const component = inferComponentFromObjectName(match.involvedObject || '');
  const tier = PSA_COMPONENTS.find((entry) => entry.name === component)?.tier || 'background';
  const imageMatch = String(match.message || '').match(/([a-z0-9./_-]+:[a-zA-Z0-9._-]+)/);
  return {
    component,
    tier,
    image: imageMatch ? imageMatch[1] : null,
    message: match.message || 'Image tag not found',
  };
}

function detectInterruptedImagePull(status) {
  const events = status.recentEvents || [];
  const match = events.find((entry) => {
    const message = String(entry.message || '');
    return /failed to pull image|imagepullbackoff|errimagepull/i.test(message) && /(context canceled|cancelled|context deadline exceeded)/i.test(message);
  });
  if (!match) {
    return null;
  }

  const component = inferComponentFromObjectName(match.involvedObject || '');
  return {
    component,
    message: match.message || 'Image pull interrupted',
  };
}

function determineTopBlocker(status) {
  const dnsSignal = detectDnsFailure(status);
  if (dnsSignal) {
    return {
      layer: 'Platform DNS resolution',
      reason: `DNS resolver failure detected: ${dnsSignal}`,
      nextAction: 'Configure explicit DNS servers (for example 1.1.1.1,8.8.8.8) in bootstrap settings, then retry.',
    };
  }

  const postgresSubPathSignal = detectPostgresSubPathFailure(status);
  if (postgresSubPathSignal) {
    return {
      layer: 'Core Postgres storage initialization',
      reason: `Postgres PVC/subPath initialization failed: ${postgresSubPathSignal}`,
      nextAction: 'Repair or recreate the Postgres PVC subPath (db-data) and restart the db pod.',
    };
  }

  const interruptedPull = detectInterruptedImagePull(status);
  if (interruptedPull) {
    return {
      layer: 'Image pull interruption',
      component: interruptedPull.component || 'unknown',
      loginBlocking: false,
      reason: `Image pull interrupted and retryable: ${interruptedPull.message}`,
      nextAction: 'Wait for automatic retry or restart the affected pod if retries stall.',
    };
  }

  const missingImage = detectMissingImageTag(status);
  if (missingImage) {
    const isLoginBlocking = missingImage.tier !== 'background';
    const imageDescriptor = missingImage.image || 'referenced image tag';
    return {
      layer: 'Image tag availability',
      component: missingImage.component || 'unknown',
      loginBlocking: isLoginBlocking,
      reason: `Image tag not found: ${imageDescriptor}`,
      nextAction: 'Publish the missing image tag or update the appliance release manifest to a valid tag.',
    };
  }

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

function statusFromHealth(healthy) {
  if (healthy === true) {
    return 'healthy';
  }
  return 'degraded';
}

function toCanonicalStatus(status) {
  const componentRows = status.workloads.components.map((component) => ({
    name: component.name,
    tier: PSA_COMPONENTS.find((entry) => entry.name === component.name)?.tier || 'background',
    ready: component.status === 'healthy',
    status: component.status,
    message: component.message || '',
    namespace: component.namespace,
  }));

  const coreComponentNames = new Set(['db', 'redis', 'pgbouncer']);
  const coreRows = componentRows.filter((component) => coreComponentNames.has(component.name));
  const coreReady = coreRows.length > 0 && coreRows.every((component) => component.ready);
  const loginReady = coreReady && componentRows.find((component) => component.name === 'alga-core')?.ready === true;
  const backgroundRows = componentRows.filter((component) => component.tier === 'background');
  const backgroundReady = backgroundRows.every((component) => component.ready);
  const platformReady =
    status.host.status === 'healthy' &&
    status.cluster.apiReachable &&
    status.cluster.status === 'healthy' &&
    status.flux.status === 'healthy';
  const bootstrapReady = status.flux.helmStatus === 'healthy' && coreReady;
  const fullyHealthy = loginReady && backgroundReady;

  const blockers =
    status.topBlocker.layer === 'none'
      ? []
      : [
          {
            severity:
              typeof status.topBlocker.loginBlocking === 'boolean'
                ? status.topBlocker.loginBlocking
                  ? 'critical'
                  : 'background'
                : loginReady
                  ? 'background'
                  : 'critical',
            component: status.topBlocker.component || status.topBlocker.layer,
            layer: status.topBlocker.layer,
            reason: status.topBlocker.reason,
            nextAction: status.topBlocker.nextAction,
            loginBlocking:
              typeof status.topBlocker.loginBlocking === 'boolean' ? status.topBlocker.loginBlocking : !loginReady,
          },
        ];

  let rollupState = 'installing';
  let rollupMessage = 'Appliance installation is in progress.';
  let nextAction = 'Wait for readiness checks to complete.';

  if (!platformReady || !coreReady || !bootstrapReady || !loginReady) {
    if (blockers.length > 0) {
      rollupState = 'failed_action_required';
      rollupMessage = 'A core platform blocker requires action before login is available.';
      nextAction = blockers[0].nextAction;
    }
  } else if (fullyHealthy) {
    rollupState = 'fully_healthy';
    rollupMessage = 'All selected services are healthy.';
    nextAction = 'No immediate action required.';
  } else if (loginReady) {
    if (backgroundReady) {
      rollupState = 'ready_to_log_in';
      rollupMessage = 'Alga is ready to log in.';
      nextAction = 'Open the login URL.';
    } else {
      rollupState = 'ready_with_background_issues';
      rollupMessage = 'Alga is ready to log in. Background services need attention.';
      nextAction = blockers[0]?.nextAction || 'Open the login URL and review background blockers.';
    }
  }

  return {
    siteId: status.siteId,
    timestamp: status.timestamp,
    release: {
      selectedReleaseVersion: status.release.selectedReleaseVersion,
      appVersion: status.release.metadata?.app?.version || null,
      channel: status.release.metadata?.channel || null,
      gitRevision: status.release.metadata?.app?.releaseBranch || null,
    },
    urls: {
      statusUrl: status.nodeIp ? `http://${status.nodeIp}:8080` : null,
      loginUrl: status.release.appUrl || (status.nodeIp ? `http://${status.nodeIp}:3000` : null),
    },
    rollup: {
      state: rollupState,
      message: rollupMessage,
      nextAction,
    },
    tiers: {
      platform: { ready: platformReady, status: statusFromHealth(platformReady) },
      core: { ready: coreReady, status: statusFromHealth(coreReady) },
      bootstrap: { ready: bootstrapReady, status: statusFromHealth(bootstrapReady) },
      login: { ready: loginReady, status: statusFromHealth(loginReady) },
      background: { ready: backgroundReady, status: statusFromHealth(backgroundReady) },
      fullHealth: { ready: fullyHealthy, status: statusFromHealth(fullyHealthy) },
    },
    topBlockers: blockers,
    components: componentRows,
    recentEvents: status.recentEvents,
  };
}

function summarizeEvents(eventsJson) {
  const items = eventsJson?.items || [];
  return items
    .slice(0, 20)
    .map((item) => ({
      namespace: item.metadata?.namespace || 'unknown',
      reason: item.reason || 'Unknown',
      type: item.type || 'Normal',
      message: item.message || '',
      lastTimestamp: item.lastTimestamp || item.eventTime || item.metadata?.creationTimestamp || null,
      involvedObject: `${item.involvedObject?.kind || 'Unknown'}/${item.involvedObject?.name || 'unknown'}`,
    }));
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
    apiError: apiResult.ok ? '' : apiResult.output,
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

  let recentEvents = [];
  if (cluster.apiReachable) {
    const eventsResult = await shell.runCapture('kubectl', [
      '--kubeconfig',
      kubeconfig,
      'get',
      'events',
      '--sort-by=.metadata.creationTimestamp',
      '-A',
      '-o',
      'json',
    ]);
    recentEvents = summarizeEvents(eventsResult.ok ? parseJsonOutput(eventsResult.output) : null);
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
    recentEvents,
  };

  status.connectivityMode = determineConnectivity(status);
  status.topBlocker = determineTopBlocker(status);
  status.canonical = toCanonicalStatus(status);
  return status;
}
