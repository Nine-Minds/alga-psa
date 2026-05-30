import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const reapplyScript = path.join(repoRoot, 'ee', 'appliance', 'bin', 'alga-control-plane-reapply');

test('T007 fallback reapply is idempotent and non-destructive by plan', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-control-plane-reapply-'));
  const applianceRoot = path.join(tmp, 'opt', 'alga-appliance');
  const imageDir = path.join(applianceRoot, 'control-plane', 'images');
  const manifestDir = path.join(applianceRoot, 'control-plane', 'manifests');
  const storageDir = path.join(applianceRoot, 'manifests');
  const tokenFile = path.join(tmp, 'setup-token');

  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, 'control-plane.tar'), 'fake archive');
  fs.writeFileSync(path.join(manifestDir, 'kustomization.yaml'), 'resources: []\n');
  fs.writeFileSync(path.join(manifestDir, 'namespace.yaml'), 'kind: Namespace\n');
  fs.writeFileSync(path.join(storageDir, 'local-path-storage.yaml'), 'kind: List\n');
  fs.writeFileSync(tokenFile, 'token-123\n');

  const result = spawnSync(reapplyScript, [
    '--appliance-root', applianceRoot,
    '--kubeconfig', path.join(tmp, 'k3s.yaml'),
    '--token-file', tokenFile,
    '--dry-run'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /k3s ctr images import/);
  assert.match(result.stdout, /kubectl --kubeconfig .* apply -f .*local-path-storage\.yaml/);
  assert.match(result.stdout, /kubectl --kubeconfig .* apply -f .*namespace\.yaml/);
  // Token is read from the host volume; the reapply path no longer creates a Secret.
  assert.doesNotMatch(result.stdout, /create secret generic appliance-setup-token/);
  assert.match(result.stdout, /kubectl --kubeconfig .* apply -k .*control-plane\/manifests/);
  assert.match(result.stdout, /kubectl --kubeconfig .* -n alga-appliance-control-plane get pods,svc,cm,secrets/);
  assert.match(result.stdout, /kubectl --kubeconfig .* get nodes/);

  assert.doesNotMatch(result.stdout, /\bdelete\b/);
  assert.doesNotMatch(result.stdout, /reset/);
  assert.doesNotMatch(result.stdout, /rm -rf/);
  assert.doesNotMatch(result.stdout, /kubectl .*replace --force/);
});
