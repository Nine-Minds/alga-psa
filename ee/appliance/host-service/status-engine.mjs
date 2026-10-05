#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const DEFAULT_STATE_FILE = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';
const DEFAULT_SETUP_INPUTS_FILE = process.env.ALGA_APPLIANCE_SETUP_INPUTS_FILE || '/var/lib/alga-appliance/setup-inputs.json';
const DEFAULT_RELEASE_SELECTION_FILE = process.env.ALGA_APPLIANCE_RELEASE_SELECTION_FILE || '/var/lib/alga-appliance/release-selection.json';
// Honor the control plane's configured kubeconfig (the pod's in-cluster
// kubeconfig) instead of the bare-host path, so status queries actually reach
// the cluster from inside the control-plane pod.
const DEFAULT_KUBECONFIG = process.env.ALGA_APPLIANCE_KUBECONFIG || '/etc/rancher/k3s/k3s.yaml';
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

function redactSetupInputs(setupInputs) {
  if (!setupInputs) return setupInputs;
  const redacted = { ...setupInputs };
  if (redacted.initialTenant) {
    redacted.initialTenant = { ...redacted.initialTenant };
    delete redacted.initialTenant.adminPassword;
  }
  return redacted;
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
    return 'registry-release-source';
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

function isEarlyKubernetesBootstrapPhase(phase) {
  const normalized = String(phase || 'setup').toLowerCase();
  return [
    'setup',
    'dns',
    'network',
    'registry-release-source',
    'release',
    'storage',
    'k3s',
    'flux'
  ].some((earlyPhase) => normalized.includes(earlyPhase));
}

// Cluster queries return the cluster reader's result shape:
// { ok: true, items } or { ok: false, reason, status, error } where reason is
// one of timeout | unreachable | unavailable | not-found | forbidden | error.
const CLUSTER_UNAVAILABLE_REASONS = new Set(['timeout', 'unreachable', 'unavailable']);

function isKubernetesQueryUnavailable(result) {
  return !result?.ok && CLUSTER_UNAVAILABLE_REASONS.has(result?.reason);
}

function skippedKubernetesQuery(reason) {
  return { ok: true, items: [], skipped: `Skipped after ${reason}.` };
}

function queryError(result) {
  return String(result?.error || 'unknown error').trim();
}

function isExpectedEarlyKubernetesUnavailable(installState, results) {
  if (!isEarlyKubernetesBootstrapPhase(installState?.phase)) {
    return false;
  }

  if (installState?.failure) {
    return false;
  }

  return results.some(isKubernetesQueryUnavailable);
}

// Flux CRDs are applied by the setup workflow after k3s is up, so a missing
// HelmRelease resource type is progress, not a failure.
function isExpectedHelmReleaseCrdUnavailable(installState, result) {
  if (installState?.failure || result?.ok) {
    return false;
  }

  return result?.reason === 'not-found';
}

// --- Kubernetes objects -> the records the readiness logic reasons about ----

function timestampString(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

// The pod STATUS kubectl prints: the most specific waiting/terminated reason,
// otherwise the phase ("Completed" for a succeeded pod).
export function podDisplayStatus(pod) {
  if (pod?.metadata?.deletionTimestamp) return 'Terminating';
  const phase = pod?.status?.phase || 'Unknown';
  let reason = pod?.status?.reason || '';

  const initStatuses = pod?.status?.initContainerStatuses || [];
  for (let i = 0; i < initStatuses.length; i += 1) {
    const state = initStatuses[i].state || {};
    if (state.terminated && state.terminated.exitCode === 0) continue;
    if (state.terminated) return `Init:${state.terminated.reason || 'Error'}`;
    if (state.waiting?.reason && state.waiting.reason !== 'PodInitializing') return `Init:${state.waiting.reason}`;
    return `Init:${i}/${initStatuses.length}`;
  }

  for (const status of [...(pod?.status?.containerStatuses || [])].reverse()) {
    const state = status.state || {};
    if (state.waiting?.reason) reason = state.waiting.reason;
    else if (state.terminated?.reason) reason = state.terminated.reason;
  }

  if (reason && !(reason === 'Completed' && phase === 'Running')) return reason;
  return phase === 'Succeeded' ? 'Completed' : phase;
}

function podRecord(pod) {
  const statuses = pod?.status?.containerStatuses || [];
  const status = podDisplayStatus(pod);
  return {
    namespace: pod?.metadata?.namespace || 'default',
    name: pod?.metadata?.name || 'unknown',
    status,
    ready: `${statuses.filter((item) => item.ready).length}/${(pod?.spec?.containers || []).length || statuses.length}`,
    restarts: statuses.reduce((sum, item) => sum + (item.restartCount || 0), 0),
    healthy: status === 'Running' || status === 'Completed'
  };
}

function jobRecord(job) {
  const completions = job?.spec?.completions ?? 1;
  const succeeded = job?.status?.succeeded || 0;
  return {
    name: job?.metadata?.name || 'unknown',
    completions: `${succeeded}/${completions}`,
    completed: succeeded >= completions,
    failed: (job?.status?.conditions || []).some((condition) => condition.type === 'Failed' && condition.status === 'True')
  };
}

function helmReleaseRecord(release) {
  const ready = (release?.status?.conditions || []).find((condition) => condition.type === 'Ready');
  return {
    name: release?.metadata?.name || 'unknown',
    ready: ready?.status || 'Unknown',
    reason: ready?.reason || null,
    message: ready?.message || null
  };
}

function nodeRecord(node) {
  return {
    name: node?.metadata?.name || 'unknown',
    ready: (node?.status?.conditions || []).some((condition) => condition.type === 'Ready' && condition.status === 'True')
  };
}

function eventRecord(item) {
  return {
    type: item.type || 'Normal',
    reason: item.reason || 'Event',
    namespace: item.metadata?.namespace || item.involvedObject?.namespace || 'default',
    involvedObject: item.involvedObject
      ? `${item.involvedObject.kind || 'Object'}/${item.involvedObject.name || 'unknown'}`
      : 'Object/unknown',
    message: item.message || '',
    timestamp: timestampString(item.lastTimestamp || item.eventTime || item.metadata?.creationTimestamp)
  };
}

function appUrlFromInput(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function guidanceForCategory(category) {
  if (category === 'dns') {
    return 'Check resolver settings and internal DNS reachability before retrying.';
  }
  if (category === 'network') {
    return 'Check outbound HTTPS, proxy variables, and firewall egress policy.';
  }
  if (category === 'registry-release-source') {
    return 'Verify GHCR access, the selected appliance release channel, and proxy/firewall policy.';
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

const NETWORK_CLASS_CATEGORIES = ['network', 'dns', 'registry-release-source'];

// Steps the live network probe (registry DNS + GHCR + release manifest) actually
// exercises. A recorded failure outside this set — notably `redeem-install-code`
// — is never treated as resolved just because the probe passes.
const PROBE_COVERED_FAILURE_STEPS = new Set([
  'resolve-system-resolvers',
  'resolve-registry-host',
  'reach-ghcr',
  'resolve-release-manifest',
  'network-probe'
]);

// Builds a failure-summary entry from a live network probe. When `resolved` is
// true the probe currently passes but a network-class failure was previously
// recorded, so we surface an accurate, actionable retry blocker instead of the
// stale recorded text.
function networkFailureSummary(probe, { resolved }) {
  const checkedAt = probe?.checkedAt || null;
  if (resolved) {
    return {
      category: 'network',
      phase: 'network',
      lastAction: 'Earlier setup attempt halted at the network check.',
      suspectedCause: 'The earlier setup attempt stopped at the outbound network check, but outbound network checks pass now.',
      suggestedNextStep: 'Re-run setup to continue the installation.',
      retrySafe: true,
      resolved: true,
      checkedAt,
      logs: ['journalctl -u alga-appliance.service -u alga-appliance-console.service -n 200']
    };
  }

  const failure = probe?.failure || {};
  const category = classifyFailureCategory(failure.phase, '', failure);
  return {
    category,
    phase: failure.phase || 'network',
    lastAction: failure.message || 'Network reachability check failed.',
    suspectedCause: failure.suspectedCause || failure.message || 'Network reachability check failed.',
    suggestedNextStep: failure.suggestedNextStep || failure.details || guidanceForCategory(category),
    retrySafe: failure.retrySafe !== false,
    checkedAt,
    logs: ['journalctl -u alga-appliance.service -u alga-appliance-console.service -n 200']
  };
}

// Releases whose failure leaves login working (see deriveReadiness): their
// blockers are background-severity, not login blockers.
const BACKGROUND_HELM_RELEASES = new Set(['email-service', 'temporal', 'temporal-worker', 'workflow-worker']);

function helmReleaseIssues(releases) {
  const issues = releases
    .filter((release) => release.ready !== 'True')
    .map((release) => ({ release: release.name, text: `${release.name}: ${release.message || release.reason || 'not ready'}` }));

  if (releases.length > 0) {
    const seen = new Set(releases.map((release) => release.name));
    for (const name of EXPECTED_HELM_RELEASES) {
      if (!seen.has(name)) {
        issues.push({ release: name, text: `${name} missing from alga-system HelmReleases` });
      }
    }
  }

  return issues;
}

function isTransientHelmReleaseConvergenceIssue(issue) {
  const lower = String(issue?.text || '').toLowerCase();
  return lower.includes("running 'install' action with timeout") ||
    lower.includes('running "install" action with timeout') ||
    lower.includes("dependency 'alga-system/alga-core' is not ready") ||
    lower.includes('dependency "alga-system/alga-core" is not ready');
}

function blockingHelmReleaseIssues(installState, helmIssues) {
  if (installState?.failure) {
    return helmIssues;
  }

  return helmIssues.filter((issue) => !isTransientHelmReleaseConvergenceIssue(issue));
}

function deriveFailureSummary(installState, pods, helmIssues, warnings) {
  const summaries = [];
  const phase = installState?.phase || 'unknown';
  const status = installState?.status || 'unknown';
  const failure = installState?.failure || null;

  if (failure) {
    const category = classifyFailureCategory(phase, status, failure);
    summaries.push({
      category,
      phase,
      step: failure.step || null,
      lastAction: installState?.lastAction || failure.message || 'Failure reported.',
      suspectedCause: failure.suspectedCause || failure.message || 'Unknown failure.',
      details: failure.details || null,
      suggestedNextStep: failure.suggestedNextStep || guidanceForCategory(category),
      retrySafe: failure.retrySafe !== false,
      logs: [
        'journalctl -u alga-appliance.service -u alga-appliance-console.service -n 200',
        'kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get events -A --sort-by=.lastTimestamp | tail -n 100'
      ]
    });
  }

  const backgroundIssuePods = backgroundPodIssues(pods);
  if (backgroundIssuePods.length > 0) {
    summaries.push({
      category: 'background-services',
      phase: 'background-services',
      lastAction: 'Background services are degraded.',
      suspectedCause: `Detected ${backgroundIssuePods.length} unhealthy background workload(s).`,
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
      suspectedCause: helmIssues.map((issue) => issue.text).join('; '),
      suggestedNextStep: 'Once the release\'s pods are healthy, use Recovery → "Recover releases" on the Overview to re-run the stalled upgrade (equivalent to `flux reconcile helmrelease <name> -n alga-system --force --reset`).',
      retrySafe: true,
      // A stalled email/temporal/workflow release degrades background work but
      // leaves login working; only core releases block login.
      background: helmIssues.every((issue) => BACKGROUND_HELM_RELEASES.has(issue.release)),
      releases: helmIssues.map((issue) => issue.release),
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

const BACKGROUND_SERVICE_HINTS = ['email-service', 'temporal', 'workflow-worker', 'temporal-worker'];

function backgroundPodIssues(pods) {
  return pods.filter((pod) => BACKGROUND_SERVICE_HINTS.some((hint) => pod.name.includes(hint)) && !pod.healthy);
}

function deriveReadiness(installState, nodes, pods, jobs, releases, helmIssues, warnings) {
  const readyNodeCount = nodes.filter((node) => node.ready).length;
  const platformReady = readyNodeCount > 0;
  const coreReady = platformReady && pods.some((pod) => pod.namespace === 'msp' && pod.name.includes('alga-core') && pod.healthy);
  const bootstrapReady = coreReady && (
    jobs.some((job) => job.name.includes('bootstrap') && job.completed) ||
    releases.some((release) => release.name === 'alga-core' && release.ready === 'True')
  );

  const backgroundIssues = backgroundPodIssues(pods).map((pod) => `${pod.namespace}/${pod.name} ${pod.status}`);

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
  const isBackground = failure.category === 'background-services' || failure.background === true;
  // A pending DNS activation is actionable but not a hard failure: show it so the
  // operator is not told "no blockers" while setup is gated, without styling it
  // as a critical login blocker.
  const isPendingDns = failure.pending === true;
  return {
    severity: isPendingDns ? 'info' : (isBackground ? 'background' : 'critical'),
    component: failure.category,
    layer: failure.phase,
    step: failure.step || null,
    reason: failure.suspectedCause || failure.lastAction || 'Unknown blocker.',
    details: failure.details || null,
    nextAction: failure.suggestedNextStep || guidanceForCategory(failure.category),
    autoRetry: failure.autoRetry || null,
    pending: isPendingDns ? true : undefined,
    loginBlocking: !isBackground && !isPendingDns
  };
}

function rollupFromState(installState, tiers, failures) {
  if (tiers.fullyHealthy) {
    return {
      state: 'fully_healthy',
      message: 'All appliance services are healthy.',
      nextAction: 'Open the AlgaPSA login URL.'
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

  const criticalFailure = failures.find((failure) => failure.category !== 'background-services' && failure.background !== true);
  if (criticalFailure) {
    return {
      state: 'blocked',
      message: criticalFailure.suspectedCause || criticalFailure.lastAction || 'Installation is blocked.',
      nextAction: criticalFailure.suggestedNextStep || guidanceForCategory(criticalFailure.category)
    };
  }

  if (!tiers.platformReady) {
    const phase = String(installState?.phase || 'setup').toLowerCase();
    return {
      state: 'installing',
      message: phase === 'setup' ? 'Starting the appliance installation.' : 'Preparing Kubernetes.',
      nextAction: 'Kubernetes is not ready yet. This is expected during early setup.'
    };
  }

  return {
    state: 'installing',
    message: installState?.lastAction || 'Installation is progressing.',
    nextAction: 'Wait for Flux and Helm releases to finish reconciling.'
  };
}

function deriveActiveOperations(pods) {
  return pods
    .filter((pod) => /\b(ContainerCreating|PodInitializing|Pending|ImagePullBackOff|ErrImagePull|CrashLoopBackOff)\b/i.test(pod.status))
    .slice(0, 8)
    .map((pod) => ({
      component: `${pod.namespace}/${pod.name}`,
      image: null,
      message: `${pod.name} is ${pod.status}.`,
      estimatedSizeHuman: null,
      elapsedSeconds: null,
      progressAvailable: false,
      progressPercent: null
    }));
}

function deriveBootstrapInfo(jobs) {
  const job = jobs.find((item) => item.name.includes('bootstrap'));
  if (!job) {
    return {
      job: { name: null, state: 'not_created', failed: false, completed: false },
      logs: { available: false, pod: null, container: null, tail: [], detectedErrors: [] }
    };
  }
  const { name, completed, failed } = job;
  return {
    job: { name, state: completed ? 'completed' : failed ? 'failed' : 'running', failed, completed },
    logs: { available: false, pod: null, container: null, tail: [], detectedErrors: [] }
  };
}

function buildStatusSnapshot({
  stateFile,
  setupInputsFile,
  releaseSelectionFile,
  kubeconfigPath,
  networkProbe,
  autoRetry,
  setupEngineLog,
  dnsReconcile,
  hostHealth,
  nodeResult,
  podResult,
  jobResult,
  helmResult,
  eventsResult,
  diagnostics
}) {
  const installState = readJsonFile(stateFile);
  const setupInputs = readJsonFile(setupInputsFile);
  const releaseSelection = readJsonFile(releaseSelectionFile);

  // Authority inversion for network-class failures: the recorded install-state
  // failure is only superseded by the live probe when the probe actually covers
  // the failed operation. A healthy GHCR probe must not clear a licensing
  // (`redeem-install-code`) failure, because the probe never exercises
  // redemption. Uncovered failures remain the authoritative blocker.
  const recordedFailure = installState?.failure || null;
  const recordedCategory = recordedFailure
    ? classifyFailureCategory(installState?.phase, installState?.status, recordedFailure)
    : null;
  const recordedIsNetworkClass = NETWORK_CLASS_CATEGORIES.includes(recordedCategory);
  const recordedCoveredByProbe = recordedIsNetworkClass
    && PROBE_COVERED_FAILURE_STEPS.has(String(recordedFailure?.step || ''));

  let effectiveFailure = recordedFailure;
  let liveNetworkBlocker = null;
  let resolvedNetworkFailure = null;
  let networkStatus = null;
  if (networkProbe) {
    networkStatus = { ok: Boolean(networkProbe.ok), checkedAt: networkProbe.checkedAt || null };
    if (!networkProbe.ok) {
      liveNetworkBlocker = networkFailureSummary(networkProbe, { resolved: false });
      if (recordedCoveredByProbe) effectiveFailure = null; // the live blocker supersedes the recorded one
    } else if (recordedCoveredByProbe) {
      resolvedNetworkFailure = { ...recordedFailure, resolvedByLiveCheck: true, checkedAt: networkProbe.checkedAt || null };
      effectiveFailure = null;
      liveNetworkBlocker = networkFailureSummary(networkProbe, { resolved: true });
    }
  }
  // install-state with network-class failures neutralized; used for failure
  // derivation and suppression so the rest of the readout reflects live truth.
  const failureState = effectiveFailure === recordedFailure
    ? installState
    : { ...(installState || {}), failure: effectiveFailure };

  const records = (result, toRecord) => (result.ok ? (result.items || []).map(toRecord) : []);
  const nodes = records(nodeResult, nodeRecord);
  const pods = records(podResult, podRecord);
  const jobs = records(jobResult, jobRecord);
  const releases = records(helmResult, helmReleaseRecord);

  const helmIssues = helmReleaseIssues(releases);
  const blockingHelmIssues = blockingHelmReleaseIssues(failureState, helmIssues);
  const nodeWarnings = nodeResult.ok ? [] : [`node query failed: ${queryError(nodeResult)}`];
  const podWarnings = podResult.ok ? [] : [`pod query failed: ${queryError(podResult)}`];
  const helmWarnings = helmResult.ok ? [] : [`helm release query failed: ${queryError(helmResult)}`];
  const suppressKubernetesWarnings = isExpectedEarlyKubernetesUnavailable(failureState, [
    nodeResult,
    podResult,
    helmResult
  ]);
  const suppressTransientHelmReleaseWarning = isExpectedHelmReleaseCrdUnavailable(failureState, helmResult);
  const rawWarnings = [
    ...nodeWarnings,
    ...podWarnings,
    ...(suppressTransientHelmReleaseWarning ? [] : helmWarnings)
  ];
  const warnings = suppressKubernetesWarnings ? [] : rawWarnings;
  const suppressedWarnings = suppressKubernetesWarnings
    ? [...nodeWarnings, ...podWarnings, ...helmWarnings]
    : (suppressTransientHelmReleaseWarning ? helmWarnings : []);
  const readinessWarnings = [...warnings, ...(suppressTransientHelmReleaseWarning ? helmWarnings : [])];
  const tiers = deriveReadiness(failureState, nodes, pods, jobs, releases, helmIssues, readinessWarnings);
  const derivedFailures = deriveFailureSummary(failureState, pods, blockingHelmIssues, warnings);
  const failures = liveNetworkBlocker ? [liveNetworkBlocker, ...derivedFailures] : derivedFailures;

  // During a retry the engine writes running states whose phase may momentarily
  // carry no failure object. The retry controller's last failure snapshot is the
  // durable evidence, so surface it rather than dropping the blocker — even when
  // other derived failures (e.g. transient kubectl unavailability) are present.
  if (autoRetry?.lastFailure && !failures.some((item) => item.step && item.step === autoRetry.lastFailure.step)) {
    const record = autoRetry.lastFailure;
    failures.push({
      category: record.category || 'setup',
      phase: record.phase || 'setup',
      step: record.step || null,
      lastAction: record.message || 'The last setup attempt failed.',
      suspectedCause: record.message || 'The last setup attempt failed.',
      details: record.details || null,
      suggestedNextStep: record.details || guidanceForCategory(record.category),
      retrySafe: record.retrySafe !== false,
      logs: ['journalctl -u alga-appliance.service -u alga-appliance-console.service -n 200']
    });
  }

  // A failed or pending cluster-DNS activation is its own blocker: setup cannot
  // safely redeem or let Flux pull against a resolver that still leaks the
  // customer search suffix, and this is independent of the setup retry budget.
  // The DNS reconcile record is authoritative for this step, so drop any
  // derived/retained failure carrying the same step (a retryable setup run
  // writes a `reconcile-cluster-dns` failure too) rather than double-listing it
  // and hiding the pending flag behind the generic record.
  const removeDnsStepFailures = () => {
    for (let i = failures.length - 1; i >= 0; i -= 1) {
      if (failures[i].step === 'reconcile-cluster-dns') failures.splice(i, 1);
    }
  };
  if (dnsReconcile && dnsReconcile.ok === false) {
    removeDnsStepFailures();
    failures.push({
      category: 'dns',
      phase: 'dns',
      step: 'reconcile-cluster-dns',
      lastAction: 'Cluster DNS reconciliation failed.',
      suspectedCause: dnsReconcile.error || 'Cluster DNS reconciliation failed.',
      details: dnsReconcile.error || null,
      suggestedNextStep: 'Inspect the DNS reconcile log and host k3s configuration, then reconcile again.',
      retrySafe: true,
      logs: dnsReconcile.logFile ? [`tail -n 200 ${dnsReconcile.logFile}`] : []
    });
  } else if (dnsReconcile && dnsReconcile.state === 'submitted' && dnsReconcile.ok === null) {
    removeDnsStepFailures();
    failures.push({
      category: 'dns',
      phase: 'dns',
      step: 'reconcile-cluster-dns',
      lastAction: 'Cluster DNS activation is in progress; setup is gated until it completes.',
      suspectedCause: 'Cluster DNS activation is in progress; setup is gated until it completes.',
      details: dnsReconcile.activation?.error || null,
      suggestedNextStep: 'Wait for DNS activation to finish (watch the reconcile log); if it stalls, run setup again to retry.',
      retrySafe: true,
      pending: true,
      logs: dnsReconcile.logFile ? [`tail -n 200 ${dnsReconcile.logFile}`] : []
    });
  }

  const readinessTiers = normalizeReadinessTiers(tiers);
  let rollup = rollupFromState(installState, tiers, failures);

  // When the control plane will auto-retry a retry-safe blocker, present it as an
  // in-progress automatic retry rather than a manual "re-run setup" dead end.
  if (autoRetry?.willRetry && failures.length > 0) {
    const retrySafeFailures = failures.filter((failure) => failure.retrySafe !== false);
    const pendingSeconds = autoRetry.nextAttemptInSeconds ?? 0;
    const whenSentence = pendingSeconds > 0 ? `next attempt in ~${pendingSeconds}s` : 'starting the next attempt now';
    for (const failure of retrySafeFailures) {
      failure.autoRetry = {
        attempts: autoRetry.attempts,
        maxAttempts: autoRetry.maxAttempts,
        nextAttemptInSeconds: pendingSeconds
      };
      failure.suggestedNextStep = `Continuing automatically — retry attempt ${autoRetry.attempts + 1} of ${autoRetry.maxAttempts}, ${whenSentence}. No action needed.`;
    }
    if (retrySafeFailures.length === failures.length) {
      rollup = {
        state: 'installing',
        message: `Continuing automatically (retry attempt ${autoRetry.attempts + 1} of ${autoRetry.maxAttempts}).`,
        nextAction: pendingSeconds > 0 ? `Next attempt in ~${pendingSeconds}s. No action needed.` : 'Starting the next attempt now. No action needed.'
      };
    }
  } else if (autoRetry?.exhausted) {
    for (const failure of failures) {
      failure.autoRetry = { attempts: autoRetry.attempts, maxAttempts: autoRetry.maxAttempts, exhausted: true };
      failure.suggestedNextStep = `${failure.suggestedNextStep} Automatic retries are exhausted after ${autoRetry.attempts} attempts; open the Setup page to re-run setup or collect a support bundle.`;
    }
  } else if (autoRetry?.error) {
    for (const failure of failures) {
      failure.suggestedNextStep = `${failure.suggestedNextStep} ${autoRetry.error}`;
    }
  }

  const topBlockers = failures.map(blockerFromFailure);
  const recentEvents = records(eventsResult, eventRecord)
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
    .slice(-40);
  const activeOperations = deriveActiveOperations(pods);
  const bootstrap = deriveBootstrapInfo(jobs);

  // Host hardware advisories (CPU features, disk latency). Shown alongside the
  // blockers but kept out of failures/tiers/rollup: a slow VM is a reason the
  // appliance is sluggish, not a reason it is unhealthy or login-blocked.
  const host = hostHealth || null;
  const hostAdvisories = [...(host?.cpu?.warnings || []), ...(host?.disk?.warnings || [])]
    .map((warning) => ({ ...warning, loginBlocking: false }));
  topBlockers.push(...hostAdvisories);

  return {
    source: 'ubuntu-host-service',
    setupInputs: redactSetupInputs(setupInputs),
    releaseSelection,
    installState,
    currentPhase: installState?.phase || 'setup',
    status: installState?.status || 'unknown',
    kubeconfigPath,
    network: networkStatus,
    lastRecordedError: resolvedNetworkFailure,
    engineLog: setupEngineLog || null,
    dnsReconcile: dnsReconcile || null,
    tiers,
    failures,
    readinessTiers,
    rollup,
    topBlockers,
    recentEvents,
    activeOperations,
    bootstrap,
    urls: {
      loginUrl: appUrlFromInput(setupInputs?.appHostname),
      statusUrl: null
    },
    release: releaseSelection,
    kubernetes: {
      nodes,
      podCount: pods.length,
      jobCount: jobs.length,
      helmReleaseCount: releases.length,
      warnings,
      suppressedWarnings
    },
    host: host ? { cpu: host.cpu || null, disk: host.disk?.latest || null } : null,
    diagnostics
  };
}

function statusSnapshotContext(options = {}) {
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  return {
    stateFile: options.stateFile || DEFAULT_STATE_FILE,
    setupInputsFile: options.setupInputsFile || DEFAULT_SETUP_INPUTS_FILE,
    releaseSelectionFile: options.releaseSelectionFile || DEFAULT_RELEASE_SELECTION_FILE,
    kubeconfigPath,
    kubectlPrefix: options.kubectlPrefix || `kubectl --request-timeout=20s --kubeconfig ${kubeconfigPath}`
  };
}

async function collectDiagnosticsAsync(kubectlPrefix, runner) {
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

  const diagnostics = [];
  for (const [name, command] of commands) {
    diagnostics.push({ name, ...(await runner(command, { timeoutMs: 30_000 })) });
  }
  return diagnostics;
}

// Cluster reads go through `clusterReader` (cluster-reader.mjs) and run
// concurrently; `runCommand` is only used for the opt-in diagnostics bundle.
export async function collectStatusSnapshotAsync(options = {}) {
  const reader = options.clusterReader;
  if (!reader) {
    throw new Error('collectStatusSnapshotAsync requires options.clusterReader (see cluster-reader.mjs).');
  }
  const context = statusSnapshotContext(options);
  const timeoutMs = options.clusterTimeoutMs || 15_000;
  const runner = options.runCommand || ((command, commandOptions) => Promise.resolve(runCommand(command, commandOptions)));

  const [nodeResult, ...rest] = await Promise.all([
    reader.listNodes({ timeoutMs }),
    reader.listPods({ timeoutMs }),
    reader.listJobs({ namespace: 'msp', timeoutMs }),
    reader.listHelmReleases({ namespace: 'alga-system', timeoutMs }),
    reader.listEvents({ timeoutMs })
  ]);
  // When the API itself is down, report that once (on the node query) rather
  // than as five identical warnings.
  const [podResult, jobResult, helmResult, eventsResult] = isKubernetesQueryUnavailable(nodeResult)
    ? rest.map(() => skippedKubernetesQuery('node query failed or timed out'))
    : rest;
  const diagnostics = options.includeDiagnostics === true ? await collectDiagnosticsAsync(context.kubectlPrefix, runner) : [];
  const networkProbe = options.networkProbe
    ? (typeof options.networkProbe === 'function' ? await options.networkProbe() : options.networkProbe)
    : undefined;
  const hostHealth = typeof options.hostHealth === 'function' ? options.hostHealth() : options.hostHealth;

  return buildStatusSnapshot({
    ...context,
    networkProbe,
    autoRetry: options.autoRetry,
    setupEngineLog: options.setupEngineLog,
    dnsReconcile: options.dnsReconcile,
    hostHealth,
    nodeResult,
    podResult,
    jobResult,
    helmResult,
    eventsResult,
    diagnostics
  });
}
