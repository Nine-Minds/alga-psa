import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installK3sSingleNode } from '../setup-engine.mjs';

test('installK3sSingleNode succeeds when installer command exits cleanly and kubeconfig exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-k3s-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const kubeconfigPath = path.join(tmp, 'k3s.yaml');

  const result = installK3sSingleNode({
    stateFile,
    kubeconfigPath,
    k3sVersion: 'v1.31.4+k3s1',
    installCommand: `cat > ${kubeconfigPath} <<'CFG'\napiVersion: v1\nclusters: []\ncontexts: []\nusers: []\nCFG\n`
  });

  assert.equal(result.ok, true);
  assert.equal(result.phase, 'k3s');
  assert.equal(result.kubeconfigPath, kubeconfigPath);

  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.status, 'k3s-install-complete');
  assert.equal(persisted.phase, 'k3s');
  assert.equal(persisted.k3s.kubeconfigPath, kubeconfigPath);
});

test('installK3sSingleNode defaults disable Traefik and ServiceLB', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-k3s-flags-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const kubeconfigPath = path.join(tmp, 'k3s.yaml');
  const execCapture = path.join(tmp, 'exec.txt');

  const result = installK3sSingleNode({
    stateFile,
    kubeconfigPath,
    installCommand: `printf '%s' \"$INSTALL_K3S_EXEC\" > ${execCapture}; cat > ${kubeconfigPath} <<'CFG'\napiVersion: v1\nclusters: []\ncontexts: []\nusers: []\nCFG\n`
  });

  assert.equal(result.ok, true);
  const installExec = fs.readFileSync(execCapture, 'utf8');
  assert.match(installExec, /--disable traefik/);
  assert.match(installExec, /--disable servicelb/);
});
