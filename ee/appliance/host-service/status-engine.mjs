#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const DEFAULT_STATE_FILE = '/var/lib/alga-appliance/install-state.json';
const DEFAULT_KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const HAS_GNU_TIMEOUT = spawnSync('sh', ['-c', 'command -v timeout >/dev/null 2>&1']).status === 0;

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
  return helmLines.filter((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3) {
      return false;
    }
    return fields[2] !== 'True';
  });
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

export function collectStatusSnapshot(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const kubectlPrefix = options.kubectlPrefix || `kubectl --request-timeout=5s --kubeconfig ${kubeconfigPath}`;

  const installState = readJsonFile(stateFile);
  const nodeResult = runCommand(`${kubectlPrefix} get nodes -o json`, { timeoutMs: 6_000 });
  const podResult = runCommand(`${kubectlPrefix} get pods -A --no-headers`, { timeoutMs: 6_000 });
  const jobResult = runCommand(`${kubectlPrefix} -n msp get jobs --no-headers`, { timeoutMs: 6_000 });
  const helmResult = runCommand(`${kubectlPrefix} -n alga-system get helmreleases.helm.toolkit.fluxcd.io --no-headers`, { timeoutMs: 6_000 });
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

  return {
    source: 'ubuntu-host-service',
    installState,
    currentPhase: installState?.phase || 'setup',
    status: installState?.status || 'unknown',
    kubeconfigPath,
    tiers,
    failures,
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
