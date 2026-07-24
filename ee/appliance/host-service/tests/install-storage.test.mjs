import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const installer = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'install-storage.sh');

test('storage reconciliation preserves existing volumes, removes the bundled controller, and proves a mounted write', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-storage-reconcile-'));
  const binDir = path.join(tmp, 'bin');
  const callLog = path.join(tmp, 'kubectl-calls.log');
  const inputLog = path.join(tmp, 'kubectl-input.log');
  const kubeconfig = path.join(tmp, 'k3s.yaml');
  fs.mkdirSync(binDir);
  fs.writeFileSync(kubeconfig, 'apiVersion: v1\n');

  fs.writeFileSync(path.join(binDir, 'kubectl'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_KUBE_CALL_LOG"
case "$*" in
  *"get storageclass local-path -o jsonpath={.reclaimPolicy}"*)
    printf 'Delete'
    ;;
  *"get persistentvolume -o jsonpath="*|*"get pv -o jsonpath="*)
    printf 'pv-existing\\n'
    ;;
  *"create namespace "*" --dry-run=client -o yaml"*)
    printf 'apiVersion: v1\\nkind: Namespace\\nmetadata:\\n  name: fake\\n'
    ;;
  *"apply -f -"*)
    {
      printf '%s\\n' "--- stdin for: $*"
      cat
    } >> "$FAKE_KUBE_INPUT_LOG"
    ;;
esac
exit 0
`, { mode: 0o755 });

  const result = spawnSync(installer, ['--kubeconfig', kubeconfig], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_KUBE_CALL_LOG: callLog,
      FAKE_KUBE_INPUT_LOG: inputLog,
      ALGA_APPLIANCE_STORAGE_LOCK_DIR: path.join(tmp, 'storage-reconcile.lock')
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(callLog, 'utf8');
  const appliedInput = fs.readFileSync(inputLog, 'utf8');

  assert.match(calls, /patch persistentvolume pv-existing .*persistentVolumeReclaimPolicy.*Retain/);
  assert.match(calls, /delete storageclass local-path/);
  assert.match(calls, /-n kube-system delete deployment local-path-provisioner --ignore-not-found --wait=true/);
  assert.match(calls, /-n local-path-storage rollout status deployment\/local-path-provisioner/);
  assert.match(calls, /-n storage-smoke wait --for=condition=complete/);
  assert.match(calls, /-n storage-smoke logs job\/storage-smoke/);
  assert.match(appliedInput, /disable\+:\n\s+- local-storage/);
  assert.match(appliedInput, /--disable servicelb --disable local-storage/);
  assert.match(appliedInput, /persistentVolumeClaim:\n\s+claimName: storage-smoke-pvc/);
});
