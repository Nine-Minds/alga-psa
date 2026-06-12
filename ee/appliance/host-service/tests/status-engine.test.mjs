import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStatusSnapshot, collectStatusSnapshotAsync } from '../status-engine.mjs';

const kubectlUnavailableRunner = (command) => Promise.resolve({
  ok: false,
  status: 127,
  command,
  stdout: '',
  stderr: 'sh: 1: kubectl: not found'
});

function writeStateFile(state) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-net-'));
  const stateFile = path.join(tmp, 'install-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return stateFile;
}

test('collectStatusSnapshot reads local state and kubeconfig-driven kubectl output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  const setupInputsFile = path.join(tmp, 'setup-inputs.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'flux', status: 'flux-source-complete' }));
  fs.writeFileSync(setupInputsFile, JSON.stringify({ channel: 'stable', appHostname: 'http://192.0.2.10:3000', repoBranch: 'feature/on-premise-email-processing' }));
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ selectedChannel: 'stable', repoBranch: 'feature/on-premise-email-processing' }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
if [[ "$*" == *"get nodes -o json"* ]]; then
  cat <<'JSON'
{"items":[{"metadata":{"name":"node-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
JSON
  exit 0
fi
if [[ "$*" == *"get pods -A --no-headers"* ]]; then
  cat <<'TXT'
default pod-a Running
kube-system pod-b Running
TXT
  exit 0
fi
if [[ "$*" == *"-n msp get jobs --no-headers"* ]]; then
  exit 0
fi
if [[ "$*" == *"-n alga-system get helmreleases"* ]]; then
  exit 0
fi
exit 1
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      setupInputsFile,
      releaseSelectionFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.currentPhase, 'flux');
    assert.equal(snapshot.status, 'flux-source-complete');
    assert.equal(snapshot.setupInputs.repoBranch, 'feature/on-premise-email-processing');
    assert.equal(snapshot.urls.loginUrl, 'http://192.0.2.10:3000');
    assert.equal(snapshot.releaseSelection.repoBranch, 'feature/on-premise-email-processing');
    assert.equal(snapshot.kubernetes.nodes.length, 1);
    assert.equal(snapshot.kubernetes.nodes[0].ready, true);
    assert.equal(snapshot.kubernetes.podCount, 2);
    assert.equal(snapshot.kubernetes.warnings.length, 0);
    assert.equal(snapshot.tiers.platformReady, true);
    assert.equal(snapshot.tiers.coreReady, false);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('collectStatusSnapshot includes UI contract fields for live status page', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-ui-contract-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'github-release-source', status: 'release-config-complete', lastAction: 'Release selection persisted.' }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
if [[ "$*" == *"get nodes -o json"* ]]; then
  cat <<'JSON'
{"items":[{"metadata":{"name":"node-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
JSON
  exit 0
fi
if [[ "$*" == *"get pods -A --no-headers"* ]]; then
  cat <<'TXT'
msp alga-core-abc Running
msp temporal-worker-xyz CrashLoopBackOff
TXT
  exit 0
fi
if [[ "$*" == *"-n msp get jobs --no-headers"* ]]; then
  cat <<'TXT'
alga-core-bootstrap 1/1 1 1m
TXT
  exit 0
fi
if [[ "$*" == *"-n alga-system get helmreleases"* ]]; then
  cat <<'TXT'
alga-core 1h True Helm install succeeded
temporal-worker 1h False Helm install failed
TXT
  exit 0
fi
if [[ "$*" == *"get events -A -o json"* ]]; then
  echo '{"items":[]}'
  exit 0
fi
exit 1
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.readinessTiers.platformReady.ready, true);
    assert.equal(snapshot.readinessTiers.backgroundReady.ready, false);
    assert.equal(snapshot.topBlockers.length >= 1, true);
    assert.equal(typeof snapshot.rollup.state, 'string');
    assert.equal(Array.isArray(snapshot.recentEvents), true);
    assert.equal(Array.isArray(snapshot.activeOperations), true);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('loginReady remains true when background service has issues', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-bg-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'app-readiness', status: 'release-config-complete' }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
if [[ "$*" == *"get nodes -o json"* ]]; then
  cat <<'JSON'
{"items":[{"metadata":{"name":"node-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
JSON
  exit 0
fi
if [[ "$*" == *"get pods -A --no-headers"* ]]; then
  cat <<'TXT'
msp alga-core-abc Running
alga-system temporal-worker-xyz CrashLoopBackOff
TXT
  exit 0
fi
if [[ "$*" == *"-n msp get jobs --no-headers"* ]]; then
  cat <<'TXT'
alga-core-bootstrap 1/1 1 1m
TXT
  exit 0
fi
if [[ "$*" == *"-n alga-system get helmreleases"* ]]; then
  cat <<'TXT'
alga-core 1h True Release reconciliation succeeded
TXT
  exit 0
fi
exit 1
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.tiers.loginReady, true);
    assert.equal(snapshot.tiers.backgroundReady, false);
    assert.equal(snapshot.tiers.backgroundIssues.length, 1);
    assert.equal(snapshot.failures.some((failure) => failure.category === 'background-services'), true);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('non-ready HelmReleases block fullyHealthy even when pods are running', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-hr-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'app-readiness', status: 'release-config-complete' }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
if [[ "$*" == *"get nodes -o json"* ]]; then
  cat <<'JSON'
{"items":[{"metadata":{"name":"node-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
JSON
  exit 0
fi
if [[ "$*" == *"get pods -A --no-headers"* ]]; then
  cat <<'TXT'
msp alga-core-abc Running
msp workflow-worker-xyz Running
TXT
  exit 0
fi
if [[ "$*" == *"-n msp get jobs --no-headers"* ]]; then
  cat <<'TXT'
alga-core-bootstrap 1/1 1 1m
TXT
  exit 0
fi
if [[ "$*" == *"-n alga-system get helmreleases"* ]]; then
  cat <<'TXT'
alga-core 1h True Helm install succeeded
workflow-worker 1h False Helm install failed for release msp/workflow-worker
TXT
  exit 0
fi
exit 1
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.tiers.loginReady, true);
    assert.equal(snapshot.tiers.backgroundReady, false);
    assert.equal(snapshot.tiers.fullyHealthy, false);
    assert.equal(snapshot.failures.some((failure) => failure.category === 'flux'), true);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('missing expected HelmReleases block fullyHealthy while staged kustomizations are still catching up', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-hr-missing-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'app-readiness', status: 'release-config-complete' }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
if [[ "$*" == *"get nodes -o json"* ]]; then
  cat <<'JSON'
{"items":[{"metadata":{"name":"node-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
JSON
  exit 0
fi
if [[ "$*" == *"get pods -A --no-headers"* ]]; then
  cat <<'TXT'
msp alga-core-abc Running
TXT
  exit 0
fi
if [[ "$*" == *"-n msp get jobs --no-headers"* ]]; then
  cat <<'TXT'
alga-core-bootstrap 1/1 1 1m
TXT
  exit 0
fi
if [[ "$*" == *"-n alga-system get helmreleases"* ]]; then
  cat <<'TXT'
alga-core 1h True Helm install succeeded
pgbouncer 1h True Helm install succeeded
TXT
  exit 0
fi
exit 1
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.tiers.loginReady, true);
    assert.equal(snapshot.tiers.fullyHealthy, false);
    assert.equal(snapshot.failures.some((failure) => failure.suspectedCause.includes('temporal missing')), true);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('early setup treats missing kubectl as expected install progress, not a blocker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-early-kubectl-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({
    phase: 'setup',
    status: 'setup-accepted',
    lastAction: 'Setup accepted; background workflow is starting'
  }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
echo 'sh: 1: kubectl: not found' >&2
exit 127
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.rollup.state, 'installing');
    assert.equal(snapshot.rollup.message, 'Starting the appliance installation.');
    assert.equal(snapshot.tiers.platformReady, false);
    assert.equal(snapshot.readinessTiers.platformReady.status, 'waiting_for_kubernetes');
    assert.equal(snapshot.failures.length, 0);
    assert.equal(snapshot.topBlockers.length, 0);
    assert.equal(snapshot.kubernetes.warnings.length, 0);
    assert.equal(snapshot.kubernetes.suppressedWarnings.length, 1);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('app-readiness treats HelmRelease dependency convergence as progress, not a blocker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-readiness-helm-converge-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({
    phase: 'app-readiness',
    status: 'release-config-complete',
    lastAction: 'Checking application readiness.'
  }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
if [[ "$*" == *"get nodes -o json"* ]]; then
  cat <<'JSON'
{"items":[{"metadata":{"name":"node-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
JSON
  exit 0
fi
if [[ "$*" == *"get pods -A --no-headers"* ]]; then
  cat <<'TXT'
msp alga-core-abc Running
TXT
  exit 0
fi
if [[ "$*" == *"-n msp get jobs --no-headers"* ]]; then
  exit 0
fi
if [[ "$*" == *"-n alga-system get helmreleases"* ]]; then
  cat <<'TXT'
alga-core 4m38s Unknown Running 'install' action with timeout of 30m0s
email-service 4m38s False dependency 'alga-system/alga-core' is not ready
pgbouncer 4m37s False dependency 'alga-system/alga-core' is not ready
temporal 4m37s False dependency 'alga-system/alga-core' is not ready
temporal-worker 4m36s False dependency 'alga-system/alga-core' is not ready
workflow-worker 4m35s False dependency 'alga-system/alga-core' is not ready
TXT
  exit 0
fi
if [[ "$*" == *"get events -A -o json"* ]]; then
  echo '{"items":[]}'
  exit 0
fi
exit 1
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.rollup.state, 'installing');
    assert.equal(snapshot.tiers.platformReady, true);
    assert.equal(snapshot.tiers.loginReady, false);
    assert.equal(snapshot.tiers.backgroundReady, false);
    assert.equal(snapshot.tiers.fullyHealthy, false);
    assert.equal(snapshot.kubernetes.helmReleaseCount, 6);
    assert.equal(snapshot.failures.length, 0);
    assert.equal(snapshot.topBlockers.length, 0);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('app-readiness treats missing HelmRelease CRD as transient progress, not a blocker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-readiness-helm-crd-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({
    phase: 'app-readiness',
    status: 'release-config-complete',
    lastAction: 'Checking application readiness.'
  }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
if [[ "$*" == *"get nodes -o json"* ]]; then
  cat <<'JSON'
{"items":[{"metadata":{"name":"node-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
JSON
  exit 0
fi
if [[ "$*" == *"get pods -A --no-headers"* ]]; then
  cat <<'TXT'
kube-system flux-controller-abc Running
TXT
  exit 0
fi
if [[ "$*" == *"-n msp get jobs --no-headers"* ]]; then
  exit 0
fi
if [[ "$*" == *"-n alga-system get helmreleases"* ]]; then
  printf '%s\n' "error: the server doesn't have a resource type \"helmreleases\"" >&2
  exit 1
fi
if [[ "$*" == *"get events -A -o json"* ]]; then
  echo '{"items":[]}'
  exit 0
fi
exit 1
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.rollup.state, 'installing');
    assert.equal(snapshot.rollup.message, 'Checking application readiness.');
    assert.equal(snapshot.tiers.platformReady, true);
    assert.equal(snapshot.tiers.loginReady, false);
    assert.equal(snapshot.tiers.fullyHealthy, false);
    assert.equal(snapshot.failures.length, 0);
    assert.equal(snapshot.topBlockers.length, 0);
    assert.equal(snapshot.kubernetes.warnings.length, 0);
    assert.equal(snapshot.kubernetes.suppressedWarnings.length, 1);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('app-readiness still reports kubectl query failures as blockers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-readiness-kubectl-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({
    phase: 'app-readiness',
    status: 'release-config-complete',
    lastAction: 'Checking application readiness.'
  }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, `#!/usr/bin/env bash
echo 'sh: 1: kubectl: not found' >&2
exit 127
`);
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.rollup.state, 'blocked');
    assert.equal(snapshot.failures.length, 1);
    assert.equal(snapshot.failures[0].category, 'app-readiness');
    assert.equal(snapshot.topBlockers.length, 1);
    assert.equal(snapshot.kubernetes.warnings.length, 1);
    assert.equal(snapshot.kubernetes.suppressedWarnings.length, 0);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('collectStatusSnapshot classifies persisted k3s failures', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-k3s-failure-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({
    phase: 'k3s',
    status: 'k3s-install-blocked',
    lastAction: 'k3s installation command failed.',
    failure: {
      phase: 'k3s',
      step: 'install-k3s-server',
      message: 'k3s installation command failed.',
      suspectedCause: 'k3s install failed',
      suggestedNextStep: 'inspect logs',
      retrySafe: true
    }
  }));

  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, '#!/usr/bin/env bash\nexit 1\n');
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const snapshot = collectStatusSnapshot({
      stateFile,
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.failures.length >= 1, true);
    assert.equal(snapshot.failures[0].category, 'k3s');
    assert.equal(snapshot.failures[0].retrySafe, true);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('live network probe clears a stale recorded network failure and unpoisons k8s suppression', async () => {
  const stateFile = writeStateFile({
    phase: 'network',
    status: 'preflight-blocked',
    lastAction: 'Network failure while fetching GitHub channel metadata.',
    failure: {
      phase: 'network',
      step: 'fetch-channel-metadata',
      message: 'Network failure while fetching GitHub channel metadata.',
      suspectedCause: 'Network failure while fetching GitHub channel metadata.',
      suggestedNextStep: 'Check outbound HTTPS and proxy settings. Invalid IP address: undefined',
      retrySafe: true
    }
  });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml',
    runCommand: kubectlUnavailableRunner,
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
    failure: { phase: 'network', step: 'fetch-channel-metadata', message: 'old recorded text', suspectedCause: 'old recorded text', suggestedNextStep: 'old', retrySafe: true }
  });

  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    kubeconfigPath: '/tmp/k3s.yaml',
    kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml',
    runCommand: kubectlUnavailableRunner,
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
    kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml',
    runCommand: kubectlUnavailableRunner,
    networkProbe: { ok: true, checkedAt: '2026-05-28T23:59:45.000Z', failure: null }
  });

  assert.equal(snapshot.network.ok, true);
  assert.equal(snapshot.lastRecordedError, null);
  assert.equal(snapshot.failures.some((f) => f.category === 'k3s'), true);
});

test('collectStatusSnapshot maps failure phases to expected categories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-phase-map-'));
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const kubectlPath = path.join(fakeBin, 'kubectl');
  fs.writeFileSync(kubectlPath, '#!/usr/bin/env bash\nexit 1\n');
  fs.chmodSync(kubectlPath, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const cases = [
      ['flux', 'flux-install-blocked', 'flux'],
      ['storage', 'storage-config-blocked', 'storage'],
      ['app-bootstrap', 'bootstrap-blocked', 'app-bootstrap'],
      ['app-readiness', 'readiness-blocked', 'app-readiness']
    ];

    for (const [phase, status, expectedCategory] of cases) {
      const stateFile = path.join(tmp, `${phase}.json`);
      fs.writeFileSync(stateFile, JSON.stringify({
        phase,
        status,
        lastAction: `${phase} failed`,
        failure: {
          phase,
          step: `${phase}-step`,
          message: `${phase} failed`,
          suspectedCause: `${phase} cause`,
          suggestedNextStep: `${phase} next`,
          retrySafe: true
        }
      }));

      const snapshot = collectStatusSnapshot({
        stateFile,
        kubeconfigPath: '/tmp/k3s.yaml',
        kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
      });
      assert.equal(snapshot.failures[0].category, expectedCategory);
    }
  } finally {
    process.env.PATH = originalPath;
  }
});
