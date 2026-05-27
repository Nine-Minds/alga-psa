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
    `kubectl --kubeconfig ${path.join(tmp, 'k3s.yaml')} -n alga-appliance-control-plane create secret generic appliance-setup-token`,
    `kubectl --kubeconfig ${path.join(tmp, 'k3s.yaml')} apply -k ${manifestDir}`,
    'Handoff: setup UI should be available from the Kubernetes-hosted control plane',
    'Setup token: token-123',
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
  assert.match(output, /setup handoff: http:\/\/.+:18080\/setup\?token=token-123/);
});
