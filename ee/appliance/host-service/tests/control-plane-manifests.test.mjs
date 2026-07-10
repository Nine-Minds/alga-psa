import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const manifestDir = path.join(repoRoot, 'ee', 'appliance', 'control-plane', 'manifests');

function readManifest(name) {
  return fs.readFileSync(path.join(manifestDir, name), 'utf8');
}

test('T002 control-plane manifests define isolated namespace, workload, exposure, state, and scoped RBAC', () => {
  const kustomization = readManifest('kustomization.yaml');
  const namespace = readManifest('namespace.yaml');
  const rbac = readManifest('rbac.yaml');
  const workload = readManifest('workload.yaml');
  const all = `${kustomization}\n${namespace}\n${rbac}\n${workload}`;

  assert.match(kustomization, /resources:\n\s+- namespace\.yaml\n\s+- rbac\.yaml\n\s+- workload\.yaml/);

  assert.match(namespace, /kind: Namespace\nmetadata:\n\s+name: alga-appliance-control-plane/);
  assert.match(namespace, /alga\.nineminds\.com\/appliance-plane: control/);
  assert.doesNotMatch(namespace, /name: msp\b/);

  assert.match(rbac, /kind: ServiceAccount\nmetadata:\n\s+name: appliance-control-plane\n\s+namespace: alga-appliance-control-plane/);
  assert.match(rbac, /kind: ClusterRole\nmetadata:\n\s+name: appliance-control-plane-setup-admin/);
  assert.match(rbac, /kind: ClusterRoleBinding\nmetadata:\n\s+name: appliance-control-plane/);
  assert.match(rbac, /name: appliance-control-plane-setup-admin/);
  assert.doesNotMatch(rbac, /name: cluster-admin/);
  assert.match(rbac, /rbac-rationale:/);
  assert.match(rbac, /customresourcedefinitions/);
  assert.match(rbac, /clusterrolebindings/);
  assert.match(rbac, /storageclasses/);
  assert.match(rbac, /resources: \["pods\/exec", "pods\/portforward"\]/);
  assert.match(rbac, /verbs: \["create"\]/);
  assert.doesNotMatch(rbac, /resources: \["\*"\]/);
  assert.doesNotMatch(rbac, /verbs: \["\*"\]/);
  assert.doesNotMatch(rbac, /host kubeconfig/);

  assert.match(workload, /kind: ConfigMap\nmetadata:\n\s+name: appliance-control-plane-config\n\s+namespace: alga-appliance-control-plane/);
  assert.match(workload, /ALGA_APPLIANCE_BUNDLE_ORIGIN: "baked-iso"/);
  assert.match(workload, /ALGA_APPLIANCE_TOKEN_FILE: "\/var\/lib\/alga-appliance\/setup-token"/);
  assert.match(workload, /ALGA_APPLIANCE_KUBECONFIG: "\/tmp\/alga-appliance\/kubeconfig"/);
  assert.match(workload, /ALGA_APPLIANCE_HOST_AGENT_SOCKET: "\/run\/alga-appliance\/host-agent\.sock"/);
  assert.doesNotMatch(workload, /ALGA_APPLIANCE_SKIP_K3S_INSTALL/);
  assert.doesNotMatch(workload, /ALGA_APPLIANCE_SKIP_STORAGE_INSTALL/);
  assert.doesNotMatch(workload, /kind: PersistentVolumeClaim/);
  assert.match(workload, /kind: Deployment\nmetadata:\n\s+name: appliance-control-plane\n\s+namespace: alga-appliance-control-plane/);
  assert.match(workload, /serviceAccountName: appliance-control-plane/);
  assert.match(workload, /hostNetwork: true/);
  assert.match(workload, /initContainers:\n\s+- name: init-state-permissions/);
  assert.match(workload, /command: \["sh", "-c", "mkdir -p \/var\/lib\/alga-appliance && chown 10001:10001 \/var\/lib\/alga-appliance"\]/);
  assert.match(workload, /hostPort: 8080/);
  assert.match(workload, /containerPort: 8080/);
  assert.match(workload, /image: localhost\/alga-appliance-control-plane:baked/);
  assert.match(workload, /imagePullPolicy: IfNotPresent/);
  assert.match(workload, /mountPath: \/var\/lib\/alga-appliance/);
  // Token is read from the shared host volume, not a Kubernetes Secret.
  assert.doesNotMatch(workload, /secretName: appliance-setup-token/);
  assert.doesNotMatch(workload, /alga-appliance-token/);
  assert.match(workload, /mountPath: \/run\/alga-appliance/);
  assert.match(workload, /path: \/run\/alga-appliance/);
  assert.doesNotMatch(workload, /\/etc\/rancher\/k3s\/k3s\.yaml/);
  assert.match(workload, /readinessProbe:/);
  assert.match(workload, /livenessProbe:/);
  assert.match(workload, /allowPrivilegeEscalation: false/);
  assert.match(workload, /runAsNonRoot: true/);
  assert.match(workload, /kind: Service\nmetadata:\n\s+name: appliance-control-plane\n\s+namespace: alga-appliance-control-plane/);
  assert.match(workload, /port: 8080\n\s+targetPort: setup-http/);

  assert.doesNotMatch(all, /namespace: alga-psa\b/);
});
