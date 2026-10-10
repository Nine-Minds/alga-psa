import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStatusSnapshotAsync, podDisplayStatus } from '../status-engine.mjs';

// --- fake cluster: the API object shapes cluster-reader.mjs returns ----------

const readyNode = { metadata: { name: 'node-1' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } };

function pod(namespace, name, status) {
  const base = { metadata: { namespace, name }, spec: { containers: [{ name: 'main' }] } };
  if (status === 'Running') {
    return { ...base, status: { phase: 'Running', containerStatuses: [{ name: 'main', ready: true, restartCount: 0, state: { running: {} } }] } };
  }
  if (status === 'Completed') {
    return { ...base, status: { phase: 'Succeeded', containerStatuses: [{ name: 'main', ready: false, restartCount: 0, state: { terminated: { reason: 'Completed', exitCode: 0 } } }] } };
  }
  const phase = status === 'ContainerCreating' ? 'Pending' : 'Running';
  return { ...base, status: { phase, containerStatuses: [{ name: 'main', ready: false, restartCount: 3, state: { waiting: { reason: status } } }] } };
}

function job(name, succeeded, completions = 1) {
  return { metadata: { name }, spec: { completions }, status: { succeeded } };
}

function helmRelease(name, ready, message) {
  return { metadata: { name }, status: { conditions: [{ type: 'Ready', status: ready, reason: ready === 'True' ? 'Succeeded' : 'Progressing', message }] } };
}

function fakeCluster({ nodes = [readyNode], pods = [], jobs = [], helmReleases = [], events = [], failures = {} } = {}) {
  const respond = (method, items) => async () => failures[method] || { ok: true, items };
  return {
    listNodes: respond('listNodes', nodes),
    listPods: respond('listPods', pods),
    listJobs: respond('listJobs', jobs),
    listHelmReleases: respond('listHelmReleases', helmReleases),
    listEvents: respond('listEvents', events)
  };
}

function failingReader(reason, error) {
  const result = { ok: false, reason, status: null, error };
  return fakeCluster({ failures: { listNodes: result, listPods: result, listJobs: result, listHelmReleases: result, listEvents: result } });
}

// The API is not reachable yet (no kubeconfig / k3s still starting).
const unavailableReader = failingReader('unavailable', 'Kubernetes client configuration is not available: ENOENT kubeconfig');

function writeStateFile(state) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-net-'));
  const stateFile = path.join(tmp, 'install-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return stateFile;
}

test('collectStatusSnapshotAsync reads local state and cluster objects', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const setupInputsFile = path.join(tmp, 'setup-inputs.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'flux', status: 'flux-source-complete' }));
  fs.writeFileSync(setupInputsFile, JSON.stringify({ channel: 'stable', appHostname: 'http://192.0.2.10:3000', releaseRef: '' }));
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable', selectedReleaseVersion: '1.0.0', registryHost: 'ghcr.io', repository: 'nine-minds/alga-appliance-release', manifestDigest: 'sha256:release' }));

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    setupInputsFile,
    releaseSelectionFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({ pods: [pod('default', 'pod-a', 'Running'), pod('kube-system', 'pod-b', 'Running')] })
  });

  assert.equal(snapshot.currentPhase, 'flux');
  assert.equal(snapshot.status, 'flux-source-complete');
  assert.equal(snapshot.setupInputs.channel, 'stable');
  assert.equal(snapshot.urls.loginUrl, 'http://192.0.2.10:3000');
  assert.equal(snapshot.releaseSelection.manifestDigest, 'sha256:release');
  assert.equal(snapshot.kubernetes.nodes.length, 1);
  assert.equal(snapshot.kubernetes.nodes[0].ready, true);
  assert.equal(snapshot.kubernetes.podCount, 2);
  assert.equal(snapshot.kubernetes.warnings.length, 0);
  assert.equal(snapshot.tiers.platformReady, true);
  assert.equal(snapshot.tiers.coreReady, false);
});

test('collectStatusSnapshotAsync includes UI contract fields for live status page', async () => {
  const stateFile = writeStateFile({ phase: 'registry-release-source', status: 'release-config-complete', lastAction: 'Release selection persisted.' });
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running'), pod('msp', 'temporal-worker-xyz', 'CrashLoopBackOff')],
      jobs: [job('alga-core-bootstrap', 1)],
      helmReleases: [helmRelease('alga-core', 'True', 'Helm install succeeded'), helmRelease('temporal-worker', 'False', 'Helm install failed')],
      events: [{ type: 'Warning', reason: 'BackOff', metadata: { namespace: 'msp' }, involvedObject: { kind: 'Pod', name: 'temporal-worker-xyz' }, message: 'Back-off restarting', lastTimestamp: '2026-10-05T02:00:00Z' }]
    })
  });

  assert.equal(snapshot.readinessTiers.platformReady.ready, true);
  assert.equal(snapshot.readinessTiers.backgroundReady.ready, false);
  assert.equal(snapshot.topBlockers.length >= 1, true);
  assert.equal(typeof snapshot.rollup.state, 'string');
  assert.equal(snapshot.recentEvents.length, 1);
  assert.equal(snapshot.recentEvents[0].involvedObject, 'Pod/temporal-worker-xyz');
  assert.equal(snapshot.activeOperations.length, 1);
  assert.equal(snapshot.activeOperations[0].message, 'temporal-worker-xyz is CrashLoopBackOff.');
});

test('loginReady remains true when background service has issues', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'release-config-complete' });
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running'), pod('alga-system', 'temporal-worker-xyz', 'CrashLoopBackOff')],
      jobs: [job('alga-core-bootstrap', 1)],
      helmReleases: [helmRelease('alga-core', 'True', 'Release reconciliation succeeded')]
    })
  });

  assert.equal(snapshot.tiers.loginReady, true);
  assert.equal(snapshot.tiers.backgroundReady, false);
  assert.equal(snapshot.tiers.backgroundIssues.length, 1);
  assert.equal(snapshot.failures.some((failure) => failure.category === 'background-services'), true);
});

test('non-ready HelmReleases block fullyHealthy even when pods are running', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'release-config-complete' });
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running'), pod('msp', 'workflow-worker-xyz', 'Running')],
      jobs: [job('alga-core-bootstrap', 1)],
      helmReleases: [helmRelease('alga-core', 'True', 'Helm install succeeded'), helmRelease('workflow-worker', 'False', 'Helm install failed for release msp/workflow-worker')]
    })
  });

  assert.equal(snapshot.tiers.loginReady, true);
  assert.equal(snapshot.tiers.backgroundReady, false);
  assert.equal(snapshot.tiers.fullyHealthy, false);
  assert.equal(snapshot.failures.some((failure) => failure.category === 'flux'), true);
});

// Live appliance 2026-10-05: three background releases stalled after a slow
// upgrade while login worked, yet the blocker read "critical / login blocking".
test('stalled background-only HelmReleases are background blockers, not login blockers', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'update-complete' });
  const stalled = 'Helm upgrade failed for release msp/email-service with chart email-service@0.0.0: failed early due to stalled resources';
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running'), pod('msp', 'email-service-abc', 'Running')],
      jobs: [job('alga-core-sebastian-bootstrap', 1)],
      helmReleases: [
        helmRelease('alga-core', 'True', 'Helm upgrade succeeded'),
        helmRelease('pgbouncer', 'True', 'Helm upgrade succeeded'),
        helmRelease('temporal', 'True', 'Helm upgrade succeeded'),
        helmRelease('email-service', 'False', stalled),
        helmRelease('temporal-worker', 'False', 'Helm upgrade failed for release msp/temporal-worker'),
        helmRelease('workflow-worker', 'False', 'Helm upgrade failed for release msp/workflow-worker')
      ]
    })
  });

  assert.equal(snapshot.rollup.state, 'ready_with_background_issues');
  const flux = snapshot.topBlockers.find((blocker) => blocker.component === 'flux');
  assert.ok(flux);
  assert.equal(flux.severity, 'background');
  assert.equal(flux.loginBlocking, false);
  assert.match(flux.reason, /^email-service: Helm upgrade failed/);
  assert.deepEqual(snapshot.failures.find((failure) => failure.category === 'flux').releases, ['email-service', 'temporal-worker', 'workflow-worker']);
});

test('a stalled core HelmRelease stays a login blocker', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'release-config-complete' });
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running')],
      jobs: [job('alga-core-bootstrap', 1)],
      helmReleases: [helmRelease('alga-core', 'True', 'ok'), helmRelease('pgbouncer', 'False', 'Helm upgrade failed for release msp/pgbouncer')]
    })
  });
  const flux = snapshot.topBlockers.find((blocker) => blocker.component === 'flux');
  assert.equal(flux.severity, 'critical');
  assert.equal(flux.loginBlocking, true);
});

test('missing expected HelmReleases block fullyHealthy while staged kustomizations are still catching up', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'release-config-complete' });
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running')],
      jobs: [job('alga-core-bootstrap', 1)],
      helmReleases: [helmRelease('alga-core', 'True', 'Helm install succeeded'), helmRelease('pgbouncer', 'True', 'Helm install succeeded')]
    })
  });

  assert.equal(snapshot.tiers.loginReady, true);
  assert.equal(snapshot.tiers.fullyHealthy, false);
  assert.equal(snapshot.failures.some((failure) => failure.suspectedCause.includes('temporal missing')), true);
});

test('early setup treats an unreachable Kubernetes API as expected install progress, not a blocker', async () => {
  const stateFile = writeStateFile({ phase: 'setup', status: 'setup-accepted', lastAction: 'Setup accepted; background workflow is starting' });
  const snapshot = await collectStatusSnapshotAsync({ stateFile, kubeconfigPath: '/tmp/k3s.yaml', clusterReader: unavailableReader });

  assert.equal(snapshot.rollup.state, 'installing');
  assert.equal(snapshot.rollup.message, 'Starting the appliance installation.');
  assert.equal(snapshot.tiers.platformReady, false);
  assert.equal(snapshot.readinessTiers.platformReady.status, 'waiting_for_kubernetes');
  assert.equal(snapshot.failures.length, 0);
  assert.equal(snapshot.topBlockers.length, 0);
  assert.equal(snapshot.kubernetes.warnings.length, 0);
  assert.equal(snapshot.kubernetes.suppressedWarnings.length, 1);
});

test('app-readiness treats HelmRelease dependency convergence as progress, not a blocker', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'release-config-complete', lastAction: 'Checking application readiness.' });
  const dependency = "dependency 'alga-system/alga-core' is not ready";
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running')],
      helmReleases: [
        helmRelease('alga-core', 'Unknown', "Running 'install' action with timeout of 30m0s"),
        helmRelease('email-service', 'False', dependency),
        helmRelease('pgbouncer', 'False', dependency),
        helmRelease('temporal', 'False', dependency),
        helmRelease('temporal-worker', 'False', dependency),
        helmRelease('workflow-worker', 'False', dependency)
      ]
    })
  });

  assert.equal(snapshot.rollup.state, 'installing');
  assert.equal(snapshot.tiers.platformReady, true);
  assert.equal(snapshot.tiers.loginReady, false);
  assert.equal(snapshot.tiers.backgroundReady, false);
  assert.equal(snapshot.tiers.fullyHealthy, false);
  assert.equal(snapshot.kubernetes.helmReleaseCount, 6);
  assert.equal(snapshot.failures.length, 0);
  assert.equal(snapshot.topBlockers.length, 0);
});

test('app-readiness treats missing HelmRelease CRD as transient progress, not a blocker', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'release-config-complete', lastAction: 'Checking application readiness.' });
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: fakeCluster({
      pods: [pod('kube-system', 'flux-controller-abc', 'Running')],
      failures: { listHelmReleases: { ok: false, reason: 'not-found', status: 404, error: 'Kubernetes API returned HTTP 404: the server could not find the requested resource' } }
    })
  });

  assert.equal(snapshot.rollup.state, 'installing');
  assert.equal(snapshot.rollup.message, 'Checking application readiness.');
  assert.equal(snapshot.tiers.platformReady, true);
  assert.equal(snapshot.failures.length, 0);
  assert.equal(snapshot.kubernetes.warnings.length, 0);
  assert.equal(snapshot.kubernetes.suppressedWarnings.length, 1);
});

test('app-readiness still reports Kubernetes query failures as blockers', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'release-config-complete', lastAction: 'Checking application readiness.' });
  const snapshot = await collectStatusSnapshotAsync({ stateFile, kubeconfigPath: '/tmp/k3s.yaml', clusterReader: unavailableReader });

  assert.equal(snapshot.rollup.state, 'blocked');
  assert.equal(snapshot.failures.length, 1);
  assert.equal(snapshot.failures[0].category, 'app-readiness');
  assert.equal(snapshot.topBlockers.length, 1);
  assert.equal(snapshot.kubernetes.warnings.length, 1);
  assert.equal(snapshot.kubernetes.suppressedWarnings.length, 0);
});

test('collectStatusSnapshotAsync classifies persisted k3s failures', async () => {
  const stateFile = writeStateFile({
    phase: 'k3s',
    status: 'k3s-install-blocked',
    lastAction: 'k3s installation command failed.',
    failure: { phase: 'k3s', step: 'install-k3s-server', message: 'k3s installation command failed.', suspectedCause: 'k3s install failed', suggestedNextStep: 'inspect logs', retrySafe: true }
  });
  const snapshot = await collectStatusSnapshotAsync({ stateFile, kubeconfigPath: '/tmp/k3s.yaml', clusterReader: failingReader('error', 'boom') });

  assert.equal(snapshot.failures.length >= 1, true);
  assert.equal(snapshot.failures[0].category, 'k3s');
  assert.equal(snapshot.failures[0].retrySafe, true);
});

test('host advisories are surfaced without blocking login or changing the rollup', async () => {
  const stateFile = writeStateFile({ phase: 'app-readiness', status: 'update-complete' });
  const cpuWarning = { severity: 'warning', component: 'host', layer: 'host', code: 'host-cpu-features-missing', reason: 'missing pclmulqdq', nextAction: 'set CPU type to host' };
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    hostHealth: () => ({ cpu: { warnings: [cpuWarning] }, disk: { latest: { writeAwaitMs: 42 }, warnings: [] } }),
    clusterReader: fakeCluster({
      pods: [pod('msp', 'alga-core-abc', 'Running')],
      jobs: [job('alga-core-bootstrap', 1)],
      helmReleases: ['alga-core', 'pgbouncer', 'temporal', 'workflow-worker', 'email-service', 'temporal-worker'].map((name) => helmRelease(name, 'True', 'ok'))
    })
  });

  assert.equal(snapshot.rollup.state, 'fully_healthy');
  const advisory = snapshot.topBlockers.find((blocker) => blocker.code === 'host-cpu-features-missing');
  assert.ok(advisory);
  assert.equal(advisory.loginBlocking, false);
  assert.equal(snapshot.failures.length, 0);
  assert.equal(snapshot.host.disk.writeAwaitMs, 42);
});

test('podDisplayStatus matches kubectl STATUS for the states readiness depends on', () => {
  assert.equal(podDisplayStatus(pod('msp', 'a', 'Running')), 'Running');
  assert.equal(podDisplayStatus(pod('msp', 'a', 'Completed')), 'Completed');
  assert.equal(podDisplayStatus(pod('msp', 'a', 'CrashLoopBackOff')), 'CrashLoopBackOff');
  assert.equal(podDisplayStatus(pod('msp', 'a', 'ContainerCreating')), 'ContainerCreating');
  assert.equal(podDisplayStatus({ metadata: { deletionTimestamp: '2026-10-05T00:00:00Z' }, status: { phase: 'Running' } }), 'Terminating');
  assert.equal(podDisplayStatus({ status: { phase: 'Pending', initContainerStatuses: [{ state: { waiting: { reason: 'ImagePullBackOff' } } }] } }), 'Init:ImagePullBackOff');
});

test('live network probe clears a stale recorded network failure and unpoisons k8s suppression', async () => {
  const stateFile = writeStateFile({
    phase: 'network',
    status: 'preflight-blocked',
    lastAction: 'Network failure while contacting ghcr.io.',
    failure: {
      phase: 'network',
      step: 'reach-ghcr',
      message: 'Network failure while contacting ghcr.io.',
      suspectedCause: 'Network failure while contacting ghcr.io.',
      suggestedNextStep: 'Check outbound HTTPS and proxy settings. Invalid IP address: undefined',
      retrySafe: true
    }
  });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    networkProbe: { ok: true, checkedAt: '2026-05-28T23:59:00.000Z', failure: null }
  });

  // The stale "Invalid IP address: undefined" text is gone; one accurate retry blocker remains.
  assert.equal(snapshot.network.ok, true);
  assert.equal(snapshot.lastRecordedError.resolvedByLiveCheck, true);
  assert.equal(snapshot.failures.length, 1);
  assert.equal(snapshot.failures[0].category, 'network');
  assert.equal(snapshot.failures[0].resolved, true);
  assert.equal(snapshot.failures.some((f) => String(f.suggestedNextStep).includes('Invalid IP address')), false);
  // The cleared network failure no longer poisons early-kubernetes suppression.
  assert.equal(snapshot.kubernetes.warnings.length, 0);
  assert.equal(snapshot.kubernetes.suppressedWarnings.length >= 1, true);
  assert.equal(snapshot.rollup.state, 'blocked');
});

test('live network probe failure surfaces a fresh blocker instead of the recorded one', async () => {
  const stateFile = writeStateFile({
    phase: 'network',
    status: 'preflight-blocked',
    failure: { phase: 'network', step: 'reach-ghcr', message: 'old recorded text', suspectedCause: 'old recorded text', suggestedNextStep: 'old', retrySafe: true }
  });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    networkProbe: {
      ok: false,
      checkedAt: '2026-05-28T23:59:30.000Z',
      failure: { phase: 'network', step: 'reach-ghcr', message: 'Network failure while contacting ghcr.io.', suspectedCause: 'Network failure while contacting ghcr.io.', suggestedNextStep: 'Check outbound HTTPS and proxy settings for GHCR.', retrySafe: true }
    }
  });

  assert.equal(snapshot.network.ok, false);
  assert.equal(snapshot.failures.length, 1);
  assert.equal(snapshot.failures[0].category, 'network');
  assert.equal(snapshot.failures[0].checkedAt, '2026-05-28T23:59:30.000Z');
  assert.equal(snapshot.failures[0].suspectedCause, 'Network failure while contacting ghcr.io.');
  assert.equal(snapshot.rollup.state, 'blocked');
});

test('live network probe does not alter a recorded non-network (k3s) failure', async () => {
  const stateFile = writeStateFile({
    phase: 'k3s',
    status: 'k3s-install-blocked',
    failure: { phase: 'k3s', step: 'install-k3s-server', message: 'k3s installation command failed.', suspectedCause: 'k3s install failed', suggestedNextStep: 'inspect logs', retrySafe: true }
  });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    networkProbe: { ok: true, checkedAt: '2026-05-28T23:59:45.000Z', failure: null }
  });

  assert.equal(snapshot.network.ok, true);
  assert.equal(snapshot.lastRecordedError, null);
  assert.equal(snapshot.failures.some((f) => f.category === 'k3s'), true);
});

test('a healthy network probe does not clear a licensing redemption failure', async () => {
  const stateFile = writeStateFile({
    phase: 'registry-release-source',
    status: 'runtime-values-blocked',
    lastAction: 'Could not redeem the install code.',
    failure: {
      phase: 'registry-release-source',
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      suspectedCause: 'Could not redeem the install code.',
      details: 'Destination: lic.example; DNS servers: 192.0.2.53; resolved addresses: none.',
      suggestedNextStep: 'Verify the license service is reachable and retry.',
      retrySafe: true
    }
  });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    networkProbe: { ok: true, checkedAt: '2026-05-28T23:59:00.000Z', failure: null }
  });

  assert.equal(snapshot.network.ok, true);
  assert.equal(snapshot.lastRecordedError, null);
  const licensing = snapshot.failures.find((failure) => failure.step === 'redeem-install-code');
  assert.ok(licensing, 'redemption failure must remain visible');
  assert.match(licensing.details, /lic\.example/);
  assert.equal(snapshot.topBlockers.some((blocker) => String(blocker.reason).includes('redeem')), true);
});

test('retry diagnostics stay visible while an automatic retry is in progress', async () => {
  const stateFile = writeStateFile({
    phase: 'registry-release-source',
    status: 'runtime-values-running',
    lastAction: 'Redeeming install code.',
    failure: {
      phase: 'registry-release-source',
      step: 'redeem-install-code',
      message: 'Could not redeem the install code.',
      details: 'Destination: lic.example',
      retrySafe: true
    }
  });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    autoRetry: {
      willRetry: true,
      exhausted: false,
      attempts: 2,
      maxAttempts: 5,
      nextAttemptInSeconds: 15,
      lastFailure: { attempt: 2, step: 'redeem-install-code', category: 'registry-release-source', message: 'Could not redeem the install code.', details: 'Destination: lic.example' }
    }
  });

  const failure = snapshot.failures.find((item) => item.step === 'redeem-install-code');
  assert.ok(failure, 'retained failure must be shown during the retry');
  assert.equal(failure.autoRetry.maxAttempts, 5);
  assert.match(failure.suggestedNextStep, /retry attempt 3 of 5/);
  assert.notEqual(snapshot.rollup.state, 'fully_healthy');
});

test('the durable retry failure snapshot is surfaced even when install state lost it', async () => {
  const stateFile = writeStateFile({ phase: 'preflight', status: 'preflight-running', failure: null });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    autoRetry: {
      willRetry: false,
      exhausted: true,
      attempts: 10,
      maxAttempts: 10,
      lastFailure: { attempt: 10, step: 'reach-ghcr', phase: 'network', category: 'network', message: 'Network failure while contacting ghcr.io.', details: 'Check outbound HTTPS.' }
    }
  });

  const failure = snapshot.failures.find((item) => item.step === 'reach-ghcr');
  assert.ok(failure, 'exhausted retry evidence must remain visible');
  assert.equal(failure.autoRetry.exhausted, true);
  assert.match(failure.suggestedNextStep, /retries are exhausted/);
  assert.notEqual(snapshot.topBlockers.length, 0);
});

test('a failed cluster-DNS reconcile is a distinct blocker', async () => {
  const stateFile = writeStateFile({ phase: 'preflight', status: 'preflight-running', failure: null });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    dnsReconcile: { ok: false, error: 'no usable upstream resolver was found', at: '2026-09-22T00:00:00.000Z', logFile: '/var/lib/alga-appliance/dns-reconcile.log' }
  });

  const blocker = snapshot.failures.find((item) => item.step === 'reconcile-cluster-dns');
  assert.ok(blocker, 'DNS reconcile failure must surface');
  assert.match(blocker.suspectedCause, /no usable upstream/);
  assert.equal(snapshot.dnsReconcile.ok, false);
  assert.equal(snapshot.topBlockers.some((item) => item.step === 'reconcile-cluster-dns'), true);
});

test('a pending cluster-DNS activation surfaces an actionable blocker', async () => {
  const stateFile = writeStateFile({ phase: 'dns', status: 'setup-blocked', failure: {
    step: 'reconcile-cluster-dns', phase: 'dns', message: 'Cluster DNS is not ready.', retrySafe: true
  } });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    dnsReconcile: {
      ok: null,
      state: 'submitted',
      at: '2026-09-22T00:00:00.000Z',
      logFile: '/var/lib/alga-appliance/dns-reconcile.log'
    }
  });

  const blocker = snapshot.failures.find((item) => item.step === 'reconcile-cluster-dns');
  assert.ok(blocker, 'pending DNS activation must surface as a blocker');
  assert.equal(blocker.pending, true);
  assert.match(blocker.suspectedCause, /in progress/i);
  const topBlocker = snapshot.topBlockers.find((item) => item.step === 'reconcile-cluster-dns');
  assert.ok(topBlocker, 'pending activation must appear in top blockers');
  assert.equal(topBlocker.loginBlocking, false);
  assert.equal(snapshot.dnsReconcile.ok, null);
});

test('a successful or absent DNS reconcile adds no blocker', async () => {
  const stateFile = writeStateFile({ phase: 'preflight', status: 'preflight-running', failure: null });
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    clusterReader: unavailableReader,
    dnsReconcile: { ok: true, at: '2026-09-22T00:00:00.000Z', logFile: '/var/lib/alga-appliance/dns-reconcile.log' }
  });
  assert.equal(snapshot.failures.some((item) => item.step === 'reconcile-cluster-dns'), false);
});

test('collectStatusSnapshotAsync maps failure phases to expected categories', async () => {
  const cases = [
    ['flux', 'flux-install-blocked', 'flux'],
    ['storage', 'storage-config-blocked', 'storage'],
    ['app-bootstrap', 'bootstrap-blocked', 'app-bootstrap'],
    ['app-readiness', 'readiness-blocked', 'app-readiness']
  ];

  for (const [phase, status, expectedCategory] of cases) {
    const stateFile = writeStateFile({
      phase,
      status,
      lastAction: `${phase} failed`,
      failure: { phase, step: `${phase}-step`, message: `${phase} failed`, suspectedCause: `${phase} cause`, suggestedNextStep: `${phase} next`, retrySafe: true }
    });
    const snapshot = await collectStatusSnapshotAsync({ stateFile, kubeconfigPath: '/tmp/k3s.yaml', clusterReader: failingReader('error', 'boom') });
    assert.equal(snapshot.failures[0].category, expectedCategory);
  }
});
