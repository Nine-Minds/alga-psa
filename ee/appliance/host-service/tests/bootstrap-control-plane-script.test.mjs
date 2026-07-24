import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const bootstrapScript = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'bootstrap-control-plane.sh');

test('T001 host bootstrap dry-run plans minimal k3s, image import, storage/control-plane apply, and setup handoff in order', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-bootstrap-plan-'));
  const applianceRoot = path.join(tmp, 'opt', 'alga-appliance');
  const imageDir = path.join(applianceRoot, 'control-plane', 'images');
  const manifestDir = path.join(applianceRoot, 'control-plane', 'manifests');
  const storageDir = path.join(applianceRoot, 'manifests');
  const scriptsDir = path.join(applianceRoot, 'scripts');
  const tokenFile = path.join(tmp, 'setup-token');

  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, 'control-plane.tar'), 'fake archive');
  fs.writeFileSync(path.join(manifestDir, 'kustomization.yaml'), 'resources: []\n');
  fs.writeFileSync(path.join(manifestDir, 'namespace.yaml'), 'kind: Namespace\n');
  fs.writeFileSync(path.join(storageDir, 'local-path-storage.yaml'), 'kind: List\n');
  fs.writeFileSync(path.join(scriptsDir, 'install-storage.sh'), '#!/usr/bin/env bash\n', { mode: 0o755 });
  fs.writeFileSync(tokenFile, 'token-123\n');

  const result = spawnSync(bootstrapScript, [
    '--appliance-root', applianceRoot,
    '--kubeconfig', path.join(tmp, 'k3s.yaml'),
    '--token-file', tokenFile,
    '--port', '18080',
    '--dry-run'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = result.stdout;
  const expectedInOrder = [
    'Substrate: reserving local-path storage for the appliance provisioner',
    'persist --disable local-storage in the k3s service and configuration',
    'Substrate: ensuring k3s is installed and running',
    'ensure k3s service is enabled and running with minimal local substrate options',
    'Substrate: waiting for Kubernetes API',
    'wait for kubectl --kubeconfig',
    'Control plane: importing baked image archives',
    'k3s ctr images import',
    'Control plane: applying local-path storage manifest without waiting for image pulls',
    `kubectl --kubeconfig ${path.join(tmp, 'k3s.yaml')} apply -f ${path.join(storageDir, 'local-path-storage.yaml')} || true`,
    'Control plane: applying Kubernetes-hosted setup/status manifests',
    `kubectl --kubeconfig ${path.join(tmp, 'k3s.yaml')} apply -f ${path.join(manifestDir, 'namespace.yaml')}`,
    `kubectl --kubeconfig ${path.join(tmp, 'k3s.yaml')} apply -k ${manifestDir}`,
    'Handoff: setup UI should be available from the Kubernetes-hosted control plane',
    'One-time setup token: token-123',
    `Fallback recovery: sudo ${applianceRoot}/bin/alga-control-plane-reapply`
  ];

  let previous = -1;
  for (const needle of expectedInOrder) {
    const index = output.indexOf(needle);
    assert.notEqual(index, -1, `missing output: ${needle}\n${output}`);
    assert.ok(index > previous, `out of order output: ${needle}\n${output}`);
    previous = index;
  }

  assert.match(output, /Alga Appliance bootstrap layers:/);
  assert.match(output, /setup handoff: http:\/\/.+:18080\//);
  assert.doesNotMatch(output, /\?token=/);
});

// The control-plane upgrade must stay a thin image swap. Storage repair belongs
// to the control-plane image: control-plane-entrypoint.sh runs the image's
// install-storage.sh on pod start, which mutates the host via a privileged
// hostPath Job. Reconciling here too would run the stale host copy of the
// installer against the same lock, adding rollout waits for no benefit.
test('control-plane-only upgrade swaps the image without re-running host bootstrap steps', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-bootstrap-cp-only-'));
  const applianceRoot = path.join(tmp, 'opt', 'alga-appliance');
  const manifestDir = path.join(applianceRoot, 'control-plane', 'manifests');
  const storageDir = path.join(applianceRoot, 'manifests');
  const scriptsDir = path.join(applianceRoot, 'scripts');

  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, 'kustomization.yaml'), 'resources: []\n');
  fs.writeFileSync(path.join(manifestDir, 'namespace.yaml'), 'kind: Namespace\n');
  fs.writeFileSync(path.join(storageDir, 'local-path-storage.yaml'), 'kind: List\n');
  fs.writeFileSync(path.join(scriptsDir, 'install-storage.sh'), '#!/usr/bin/env bash\n', { mode: 0o755 });
  const tokenFile = path.join(tmp, 'setup-token');
  fs.writeFileSync(tokenFile, 'token-123\n');

  const result = spawnSync(bootstrapScript, [
    '--appliance-root', applianceRoot,
    '--kubeconfig', path.join(tmp, 'k3s.yaml'),
    '--token-file', tokenFile,
    '--control-plane-only',
    '--dry-run'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = result.stdout;

  const expectedInOrder = [
    'Substrate: waiting for Kubernetes API',
    'Control plane: applying Kubernetes-hosted setup/status manifests'
  ];

  let previous = -1;
  for (const fragment of expectedInOrder) {
    const index = output.indexOf(fragment);
    assert.notEqual(index, -1, `missing plan step: ${fragment}\n${output}`);
    assert.equal(index > previous, true, `plan step out of order: ${fragment}\n${output}`);
    previous = index;
  }

  // k3s is already running on this path; it must not be restarted, baked images
  // must not be re-imported, and storage must be left to the image's entrypoint.
  assert.equal(output.includes('Substrate: ensuring k3s is installed and running'), false, output);
  assert.equal(output.includes('Control plane: importing baked image archives'), false, output);
  assert.equal(output.includes('Substrate: reserving local-path storage for the appliance provisioner'), false, output);
  assert.equal(output.includes('Control plane: applying local-path storage manifest'), false, output);
});
