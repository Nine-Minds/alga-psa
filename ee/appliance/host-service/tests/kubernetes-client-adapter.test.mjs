import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeKubernetesAdapter } from '../kubernetes-client-adapter.mjs';

// The adapter must pick the library's in-cluster service-account flow when it
// runs inside the control-plane pod. client-node's kubeconfig parser ignores
// kubectl's `tokenFile:` spelling, so loading the entrypoint-written
// kubeconfig authenticated nothing: every exec/port-forward/access-review hit
// the apiserver as anonymous and 401ed, while kubectl-driven features kept
// working. loadFromCluster() also tracks the projected token as it rotates.

function fakeK8sModule(calls) {
  class KubeConfig {
    loadFromCluster() { calls.push({ method: 'loadFromCluster' }); }
    loadFromFile(file) { calls.push({ method: 'loadFromFile', file }); }
    makeApiClient() { return {}; }
  }
  return { KubeConfig, Exec: class {}, PortForward: class {} };
}

async function detectLoad({ env, tokenExists }) {
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kca-test-'));
  const tokenPath = path.join(dir, 'token');
  if (tokenExists) fs.writeFileSync(tokenPath, 'tok');

  const previous = process.env.KUBERNETES_SERVICE_HOST;
  if (env) process.env.KUBERNETES_SERVICE_HOST = '10.43.0.1';
  else delete process.env.KUBERNETES_SERVICE_HOST;
  try {
    const adapter = createNativeKubernetesAdapter({
      kubeconfigPath: '/etc/rancher/k3s/k3s.yaml',
      moduleLoader: async () => fakeK8sModule(calls),
      serviceAccountTokenPath: tokenPath,
    });
    // Any adapter call forces the lazy client construction.
    await adapter.readPod('msp', 'some-pod').catch(() => {});
  } finally {
    if (previous === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
    else process.env.KUBERNETES_SERVICE_HOST = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return calls;
}

test('in-cluster (env + projected token present) uses loadFromCluster', async () => {
  const calls = await detectLoad({ env: true, tokenExists: true });
  assert.deepEqual(calls, [{ method: 'loadFromCluster' }]);
});

test('on the host (no KUBERNETES_SERVICE_HOST) loads the kubeconfig file', async () => {
  const calls = await detectLoad({ env: false, tokenExists: true });
  assert.deepEqual(calls, [{ method: 'loadFromFile', file: '/etc/rancher/k3s/k3s.yaml' }]);
});

test('env set but no projected token falls back to the kubeconfig file', async () => {
  const calls = await detectLoad({ env: true, tokenExists: false });
  assert.deepEqual(calls, [{ method: 'loadFromFile', file: '/etc/rancher/k3s/k3s.yaml' }]);
});
