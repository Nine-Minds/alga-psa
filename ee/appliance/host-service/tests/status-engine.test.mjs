import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStatusSnapshot } from '../status-engine.mjs';

test('collectStatusSnapshot reads local state and kubeconfig-driven kubectl output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-status-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });

  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'flux', status: 'flux-source-complete' }));

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
      kubeconfigPath: '/tmp/k3s.yaml',
      kubectlPrefix: 'kubectl --kubeconfig /tmp/k3s.yaml'
    });

    assert.equal(snapshot.currentPhase, 'flux');
    assert.equal(snapshot.status, 'flux-source-complete');
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
