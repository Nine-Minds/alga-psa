import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const launcher = path.join(repoRoot, 'ee', 'appliance', 'scripts', 'reconcile-k3s-dns.sh');
const IMAGE = `ghcr.io/nine-minds/alga-appliance-control-plane@sha256:${'a'.repeat(64)}`;

function renderManifest(extraEnv = {}) {
  const result = spawnSync('bash', [launcher, '--dry-run', '--kubeconfig', '/tmp/k3s.yaml'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ALGA_APPLIANCE_CONTROL_PLANE_IMAGE: IMAGE, ...extraEnv }
  });
  return result;
}

test('the DNS reconcile Job runs privileged in the support plane with the host helper', () => {
  const result = renderManifest();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = result.stdout;

  assert.match(manifest, /kind: Job/);
  assert.match(manifest, /namespace: alga-appliance-support/);
  assert.doesNotMatch(manifest, /namespace: alga-appliance-control-plane/);
  assert.match(manifest, /serviceAccountName: default/);
  assert.match(manifest, /hostPID: true/);
  assert.match(manifest, /privileged: true/);
  assert.match(manifest, new RegExp(`image: ${IMAGE.replace(/[.@/]/g, (m) => `\\${m}`)}`));
  assert.match(manifest, /imagePullPolicy: IfNotPresent/);
  assert.match(manifest, /configure-k3s-dns\.sh/);
  assert.match(manifest, /--activate/);
});

test('the Job namespace and service account are overridable for tests and future layouts', () => {
  const result = renderManifest({
    ALGA_APPLIANCE_DNS_JOB_NAMESPACE: 'custom-dns',
    ALGA_APPLIANCE_DNS_JOB_SA: 'custom-sa'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /namespace: custom-dns/);
  assert.match(result.stdout, /serviceAccountName: custom-sa/);
});
