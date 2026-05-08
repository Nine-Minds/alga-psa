#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const DEFAULT_STATE_FILE = '/var/lib/alga-appliance/install-state.json';
const DEFAULT_SETUP_INPUTS_FILE = '/etc/alga-appliance/setup-inputs.json';
const DEFAULT_RELEASE_SELECTION_FILE = '/etc/alga-appliance/release-selection.json';
const DEFAULT_KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const HAS_GNU_TIMEOUT = spawnSync('sh', ['-c', 'command -v timeout >/dev/null 2>&1']).status === 0;
const EXPECTED_HELM_RELEASES = ['alga-core', 'pgbouncer', 'temporal', 'workflow-worker', 'email-service', 'temporal-worker'];

function readJsonFile(file) {
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function truncateOutput(value) {
  const text = value || '';
  if (text.length <= MAX_DIAGNOSTIC_BYTES) {
    return text;
  }

  return `${text.slice(0, MAX_DIAGNOSTIC_BYTES)}\n... output truncated at ${MAX_DIAGNOSTIC_BYTES} bytes ...`;
}

function runCommand(command, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const result = HAS_GNU_TIMEOUT
    ? spawnSync('timeout', ['--kill-after=2s', `${timeoutSeconds}s`, 'sh', '-c', command], {
      env: process.env,
      encoding: 'utf8',
      timeout: timeoutMs + 3_000
    })
    : spawnSync('sh', ['-c', command], {
      env: process.env,
      encoding: 'utf8',
      timeout: timeoutMs
    });

  const timedOut = result.status === 124 || result.status === 137 || result.error?.code === 'ETIMEDOUT';
  return {
    ok: result.status === 0,
    status: timedOut ? 124 : (result.status ?? 1),
    command,
    stdout: truncateOutput(result.stdout || ''),
    stderr: truncateOutput(timedOut ? `${result.stderr || ''}\nCommand timed out after ${timeoutMs}ms.` : (result.stderr || ''))
  };
}

function collectDiagnostics(kubectlPrefix) {
  const commands = [
    ['host-service-status', 'systemctl --no-pager --full status alga-appliance.service alga-appliance-console.service'],
    ['host-service-journal', 'journalctl -u alga-appliance.service -u alga-appliance-console.service -n 200 --no-pager'],
    ['k3s-status', 'systemctl --no-pager --full status k3s'],
    ['kubernetes-namespaces', `${kubectlPrefix} get namespaces -o wide`],
    ['kubernetes-nodes', `${kubectlPrefix} get nodes -o wide`],
    ['kubernetes-pods', `${kubectlPrefix} get pods -A -o wide`],
    ['kubernetes-jobs', `${kubectlPrefix} get jobs -A -o wide`],
    ['kubernetes-helmreleases', `${kubectlPrefix} get helmreleases.helm.toolkit.fluxcd.io -A`],
    ['kubernetes-storageclasses', `${kubectlPrefix} get storageclass -o wide`],
    ['kubernetes-pv-pvc', `${kubectlPrefix} get pv,pvc -A -o wide`],
    ['kubernetes-events', `${kubectlPrefix} get events -A --sort-by=.lastTimestamp | tail -n 150`]
  ];

  return commands.map(([name, command]) => ({
    name,
    ...runCommand(command, { timeoutMs: 8_000 })
  }));
}

function classifyFailureCategory(phase, status, failure) {
  const lowerPhase = (phase || '').toLowerCase();
  const lowerStatus = (status || '').toLowerCase();
  const lowerStep = (failure?.step || '').toLowerCase();

  if (lowerPhase.includes('dns') || lowerStep.includes('resolve')) {
    return 'dns';
  }
  if (lowerPhase.includes('network') || lowerStep.includes('reach-ghcr')) {
    return 'network';
  }
  if (lowerPhase.includes('github') || lowerStatus.includes('release') || lowerStep.includes('channel')) {
    return 'github-release-source';
  }
  if (lowerPhase.includes('k3s') || lowerStatus.includes('k3s')) {
    return 'k3s';
  }
  if (lowerPhase.includes('flux') || lowerStatus.includes('flux')) {
    return 'flux';
  }
  if (lowerPhase.includes('storage') || lowerStatus.includes('storage')) {
    return 'storage';
  }
  if (lowerPhase.includes('bootstrap') || lowerStatus.includes('bootstrap')) {
    return 'app-bootstrap';
  }
  if (lowerPhase.includes('background') || lowerStatus.includes('background')) {
    return 'background-services';
  }
  return 'app-readiness';
}

function guidanceForCategory(category) {
  if (category === 'dns') {
    return 'Check resolver settings and internal DNS reachability before retrying.';
  }
  if (category === 'network') {
    return 'Check outbound HTTPS, proxy variables, and firewall egress policy.';
  }
  if (category === 'github-release-source') {
    return 'Verify GitHub repo/branch/channel file access and proxy/firewall policy.';
  }
  if (category === 'k3s') {
    return 'Inspect k3s installer output and `systemctl status k3s` on the host.';
  }
  if (category === 'flux') {
    return 'Verify Flux install/source apply output and Flux controller logs.';
  }
  if (category === 'storage') {
    return 'Inspect local-path storage installer output and storageclass state.';
  }
  if (category === 'app-bootstrap') {
    return 'Inspect bootstrap job logs and dependent service health in cluster.';
  }
  if (category === 'background-services') {
    return 'Review background worker pod logs; login readiness can remain true.';
  }
  return 'Inspect app pods/events and reconcile blockers for login readiness.';
}

function helmReleaseIssues(helmLines) {
  const seen = new Set();
  const issues = helmLines.filter((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3) {
      return false;
    }
    seen.add(fields[0]);
    return fields[2] !== 'True';
  });

  if (helmLines.length > 0) {
    for (const name of EXPECTED_HELM_RELEASES) {
      if (!seen.has(name)) {
        issues.push(`${name} missing from alga-system HelmReleases`);
      }
    }
  }

  return issues;
}

function deriveFailureSummary(installState, podLines, helmIssues, warnings) {
  const summaries = [];
  const phase = installState?.phase || 'unknown';
  const status = installState?.status || 'unknown';
  const failure = installState?.failure || null;

  if (failure) {
    const category = classifyFailureCategory(phase, status, failure);
    summaries.push({
      category,
      phase,
      lastAction: installState?.lastAction || failure.message || 'Failure reported.',
      suspectedCause: failure.suspectedCause || failure.message || 'Unknown failure.',
      suggestedNextStep: failure.suggestedNextStep || guidanceForCategory(category),
      retrySafe: failure.retrySafe !== false,
      logs: [
        'journalctl -u alga-appliance.service -u alga-appliance-console.service -n 200',
        'kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get events -A --sort-by=.lastTimestamp | tail -n 100'
      ]
    });
  }

  const backgroundHints = ['email-service', 'temporal', 'workflow-worker', 'temporal-worker'];
  const backgroundIssueLines = podLines.filter((line) => {
    const lower = line.toLowerCase();
    return backgroundHints.some((hint) => lower.includes(hint)) && !lower.includes(' running') && !lower.includes(' completed');
  });
  if (backgroundIssueLines.length > 0) {
    summaries.push({
      category: 'background-services',
      phase: 'background-services',
      lastAction: 'Background services are degraded.',
      suspectedCause: `Detected ${backgroundIssueLines.length} unhealthy background workload(s).`,
      suggestedNextStep: guidanceForCategory('background-services'),
      retrySafe: true,
      logs: ['kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A']
    });
  }

  if (helmIssues.length > 0) {
    summaries.push({
      category: 'flux',
      phase: 'flux',
      lastAction: 'One or more Helm releases are not ready.',
      suspectedCause: helmIssues.join('; '),
      suggestedNextStep: 'Run `flux reconcile helmrelease <name> -n alga-system --force --reset` after fixing the underlying pod or values issue.',
      retrySafe: true,
      logs: ['kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml -n alga-system get helmreleases']
    });
  }

  if (warnings.length > 0) {
    summaries.push({
      category: 'app-readiness',
      phase: 'app-readiness',
      lastAction: 'Cluster status collection returned warnings.',
      suspectedCause: warnings.join('; '),
      suggestedNextStep: guidanceForCategory('app-readiness'),
      retrySafe: true,
      logs: ['kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get nodes -o wide']
    });
  }

  return summaries;
}

function lineLooksHealthy(line) {
  const lower = line.toLowerCase();
  return lower.includes(' running') || lower.includes(' completed');
}

function deriveReadiness(installState, nodes, podLines, jobLines, helmLines, helmIssues, warnings) {
  const readyNodeCount = nodes.filter((node) => node.ready).length;
  const platformReady = readyNodeCount > 0;
  const coreReady = platformReady && podLines.some((line) => {
    const lower = line.toLowerCase();
    return lower.startsWith('msp ') && lower.includes('alga-core') && lineLooksHealthy(line);
  });
  const bootstrapReady = coreReady && (
    jobLines.some((line) => line.toLowerCase().includes('bootstrap') && /\s1\/1\s/.test(line)) ||
    helmLines.some((line) => line.toLowerCase().startsWith('alga-core') && line.toLowerCase().includes('true'))
  );

  const backgroundServiceHints = ['email-service', 'temporal', 'workflow-worker', 'temporal-worker'];
  const backgroundIssues = podLines.filter((line) => {
    const lower = line.toLowerCase();
    const isBackground = backgroundServiceHints.some((hint) => lower.includes(hint));
    const looksHealthy = lineLooksHealthy(line);
    return isBackground && !looksHealthy;
  });

  // Login readiness is gated by core/bootstrap, not background workloads.
  const loginReady = platformReady && coreReady && bootstrapReady;
  const backgroundReady = backgroundIssues.length === 0 && helmIssues.length === 0;
  const fullyHealthy = loginReady && backgroundReady && warnings.length === 0;

  return {
    platformReady,
    coreReady,
    bootstrapReady,
    loginReady,
    backgroundReady,
    fullyHealthy,
    backgroundIssues
  };
}

function tierStatus(ready, waitingStatus = 'waiting') {
  return ready ? 'ready' : waitingStatus;
}

function normalizeReadinessTiers(tiers) {
  return {
    platformReady: {
      ready: tiers.platformReady,
      status: tierStatus(tiers.platformReady, 'waiting_for_kubernetes')
    },
    coreReady: {
      ready: tiers.coreReady,
      status: tierStatus(tiers.coreReady, tiers.platformReady ? 'waiting_for_core' : 'blocked_by_platform')
    },
    bootstrapReady: {
      ready: tiers.bootstrapReady,
      status: tierStatus(tiers.bootstrapReady, tiers.coreReady ? 'waiting_for_bootstrap' : 'blocked_by_core')
    },
    loginReady: {
      ready: tiers.loginReady,
      status: tierStatus(tiers.loginReady, tiers.bootstrapReady ? 'ready' : 'blocked_by_bootstrap')
    },
    backgroundReady: {
      ready: tiers.backgroundReady,
      status: tiers.backgroundReady ? 'ready' : 'degraded_background_services'
    },
    fullyHealthy: {
      ready: tiers.fullyHealthy,
      status: tiers.fullyHealthy ? 'ready' : 'not_fully_healthy'
    }
  };
}

function blockerFromFailure(failure) {
  const isBackground = failure.category === 'background-services';
  return {
    severity: isBackground ? 'background' : 'critical',
    component: failure.category,
    layer: failure.phase,
    reason: failure.suspectedCause || failure.lastAction || 'Unknown blocker.',
    nextAction: failure.suggestedNextStep || guidanceForCategory(failure.category),
    loginBlocking: !isBackground
  };
}

function rollupFromState(installState, tiers, failures) {
  if (tiers.fullyHealthy) {
    return {
      state: 'fully_healthy',
      message: 'All appliance services are healthy.',
      nextAction: 'Open the Alga PSA login URL.'
    };
  }

  if (tiers.loginReady) {
    return {
      state: tiers.backgroundReady ? 'ready_to_log_in' : 'ready_with_background_issues',
      message: tiers.backgroundReady
        ? 'The core application is ready for login.'
        : 'The core application is ready, but background services still need attention.',
      nextAction: tiers.backgroundReady ? 'Open the login URL.' : 'Review background service health.'
    };
  }

  const criticalFailure = failures.find((failure) => failure.category !== 'background-services');
  if (criticalFailure) {
    return {
      state: 'blocked',
      message: criticalFailure.suspectedCause || criticalFailure.lastAction || 'Installation is blocked.',
      nextAction: criticalFailure.suggestedNextStep || guidanceForCategory(criticalFailure.category)
    };
  }

  if (!tiers.platformReady) {
    return {
      state: 'installing',
      message: 'Waiting for Kubernetes to become reachable.',
      nextAction: 'Watch k3s/Flux startup progress.'
    };
  }

  return {
    state: 'installing',
    message: installState?.lastAction || 'Installation is progressing.',
    nextAction: 'Wait for Flux and Helm releases to finish reconciling.'
  };
}

function parseEventsJson(output) {
  try {
    const parsed = JSON.parse(output || '{}');
    return (parsed.items || []).map((item) => ({
      type: item.type || 'Normal',
      reason: item.reason || 'Event',
      namespace: item.metadata?.namespace || item.involvedObject?.namespace || 'default',
      involvedObject: item.involvedObject
        ? `${item.involvedObject.kind || 'Object'}/${item.involvedObject.name || 'unknown'}`
        : 'Object/unknown',
      message: item.message || '',
      timestamp: item.lastTimestamp || item.eventTime || item.metadata?.creationTimestamp || null
    })).sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  } catch {
    return [];
  }
}

function deriveActiveOperations(podLines) {
  return podLines
    .filter((line) => /\b(ContainerCreating|PodInitializing|Pending|ImagePullBackOff|ErrImagePull|CrashLoopBackOff)\b/i.test(line))
    .slice(0, 8)
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      const namespace = fields[0] || 'unknown';
      const pod = fields[1] || 'unknown';
      const status = fields[3] || fields[2] || 'unknown';
      return {
        component: `${namespace}/${pod}`,
        image: null,
        message: `${pod} is ${status}.`,
        estimatedSizeHuman: null,
        elapsedSeconds: null,
        progressAvailable: false,
        progressPercent: null
      };
    });
}

function deriveBootstrapInfo(jobLines) {
  const jobLine = jobLines.find((line) => line.toLowerCase().includes('bootstrap'));
  if (!jobLine) {
    return {
      job: { name: null, state: 'not_created', failed: false, completed: false },
      logs: { available: false, pod: null, container: null, tail: [], detectedErrors: [] }
    };
  }
  const fields = jobLine.split(/\s+/);
  const name = fields[0];
  const completed = /\s1\/1\s/.test(jobLine);
  const failed = /failed/i.test(jobLine);
  return {
    job: { name, state: completed ? 'completed' : failed ? 'failed' : 'running', failed, completed },
    logs: { available: false, pod: null, container: null, tail: [], detectedErrors: [] }
  };
}

export function collectStatusSnapshot(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const setupInputsFile = options.setupInputsFile || DEFAULT_SETUP_INPUTS_FILE;
  const releaseSelectionFile = options.releaseSelectionFile || DEFAULT_RELEASE_SELECTION_FILE;
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const kubectlPrefix = options.kubectlPrefix || `kubectl --request-timeout=5s --kubeconfig ${kubeconfigPath}`;

  const installState = readJsonFile(stateFile);
  const setupInputs = readJsonFile(setupInputsFile);
  const releaseSelection = readJsonFile(releaseSelectionFile);
  const nodeResult = runCommand(`${kubectlPrefix} get nodes -o json`, { timeoutMs: 6_000 });
  const podResult = runCommand(`${kubectlPrefix} get pods -A --no-headers`, { timeoutMs: 6_000 });
  const jobResult = runCommand(`${kubectlPrefix} -n msp get jobs --no-headers`, { timeoutMs: 6_000 });
  const helmResult = runCommand(`${kubectlPrefix} -n alga-system get helmreleases.helm.toolkit.fluxcd.io --no-headers`, { timeoutMs: 6_000 });
  const eventsResult = runCommand(`${kubectlPrefix} get events -A -o json`, { timeoutMs: 6_000 });
  const diagnostics = options.includeDiagnostics === true ? collectDiagnostics(kubectlPrefix) : [];

  let nodes = [];
  if (nodeResult.ok) {
    try {
      const parsed = JSON.parse(nodeResult.stdout);
      nodes = (parsed.items || []).map((item) => ({
        name: item.metadata?.name || 'unknown',
        ready: (item.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True')
      }));
    } catch {
      nodes = [];
    }
  }

  const podLines = podResult.ok
    ? podResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];

  const jobLines = jobResult.ok
    ? jobResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const helmLines = helmResult.ok
    ? helmResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];

  const helmIssues = helmReleaseIssues(helmLines);
  const warnings = [
    ...(nodeResult.ok ? [] : [`node query failed: ${nodeResult.stderr.trim() || nodeResult.stdout.trim() || 'unknown error'}`]),
    ...(podResult.ok ? [] : [`pod query failed: ${podResult.stderr.trim() || podResult.stdout.trim() || 'unknown error'}`]),
    ...(helmResult.ok ? [] : [`helm release query failed: ${helmResult.stderr.trim() || helmResult.stdout.trim() || 'unknown error'}`])
  ];
  const tiers = deriveReadiness(installState, nodes, podLines, jobLines, helmLines, helmIssues, warnings);
  const failures = deriveFailureSummary(installState, podLines, helmIssues, warnings);
  const readinessTiers = normalizeReadinessTiers(tiers);
  const rollup = rollupFromState(installState, tiers, failures);
  const topBlockers = failures.map(blockerFromFailure);
  const recentEvents = eventsResult.ok ? parseEventsJson(eventsResult.stdout).slice(-40) : [];
  const activeOperations = deriveActiveOperations(podLines);
  const bootstrap = deriveBootstrapInfo(jobLines);

  return {
    source: 'ubuntu-host-service',
    setupInputs,
    releaseSelection,
    installState,
    currentPhase: installState?.phase || 'setup',
    status: installState?.status || 'unknown',
    kubeconfigPath,
    tiers,
    failures,
    readinessTiers,
    rollup,
    topBlockers,
    recentEvents,
    activeOperations,
    bootstrap,
    urls: {
      loginUrl: setupInputs?.appHostname ? `https://${String(setupInputs.appHostname).replace(/^https?:\/\//i, '')}` : null,
      statusUrl: null
    },
    release: releaseSelection,
    kubernetes: {
      nodes,
      podCount: podLines.length,
      jobCount: jobLines.length,
      helmReleaseCount: helmLines.length,
      warnings
    },
    diagnostics
  };
}
