import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));

test('control-plane state files are host-backed and used by setup, status, and support paths', () => {
  const workload = fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'control-plane', 'manifests', 'workload.yaml'), 'utf8');
  const server = fs.readFileSync(path.join(repoRoot, 'ee', 'appliance', 'host-service', 'server.mjs'), 'utf8');

  assert.match(workload, /ALGA_APPLIANCE_STATE_FILE: "\/var\/lib\/alga-appliance\/install-state\.json"/);
  assert.match(workload, /ALGA_APPLIANCE_TOKEN_FILE: "\/var\/lib\/alga-appliance-token\/setup-token"/);
  assert.match(workload, /ALGA_APPLIANCE_KUBECONFIG: "\/tmp\/alga-appliance\/kubeconfig"/);
  assert.match(workload, /ALGA_APPLIANCE_HOST_AGENT_SOCKET: "\/run\/alga-appliance\/host-agent\.sock"/);
  assert.match(workload, /ALGA_APPLIANCE_SETUP_INPUTS_FILE: "\/var\/lib\/alga-appliance\/setup-inputs\.json"/);
  assert.match(workload, /ALGA_APPLIANCE_RELEASE_SELECTION_FILE: "\/var\/lib\/alga-appliance\/release-selection\.json"/);
  assert.match(workload, /mountPath: \/var\/lib\/alga-appliance/);
  assert.match(workload, /hostPath:\n\s+path: \/var\/lib\/alga-appliance/);
  assert.match(workload, /secretName: appliance-setup-token/);
  assert.match(workload, /mountPath: \/var\/lib\/alga-appliance-token/);
  assert.match(workload, /mountPath: \/run\/alga-appliance/);
  assert.match(workload, /hostPath:\n\s+path: \/run\/alga-appliance/);
  assert.doesNotMatch(workload, /\/etc\/rancher\/k3s\/k3s\.yaml/);

  assert.match(server, /const releaseSelectionFile = process\.env\.ALGA_APPLIANCE_RELEASE_SELECTION_FILE/);
  assert.match(server, /'--release-selection-file', releaseSelectionFile/);
  assert.match(server, /collectStatusSnapshotAsync\(\{\n\s+stateFile,\n\s+setupInputsFile,\n\s+releaseSelectionFile,/);
  assert.match(server, /generateSupportBundle\(\{ stateFile, setupInputsFile, releaseSelectionFile \}\)/);
});
