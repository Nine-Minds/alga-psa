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
  } finally {
    process.env.PATH = originalPath;
  }
});
