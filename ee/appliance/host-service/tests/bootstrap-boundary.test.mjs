import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertHostBootstrapBoundary,
  buildHostBootstrapPlan,
  CONTROL_PLANE_RESPONSIBILITIES
} from '../bootstrap-boundary.mjs';

test('new-install host bootstrap boundary is minimal, ordered, offline, and idempotent', () => {
  const plan = buildHostBootstrapPlan({
    applianceRoot: '/opt/alga-appliance',
    setupPort: 8080,
    setupTokenFile: '/var/lib/alga-appliance/setup-token'
  });

  assert.equal(plan.boundaryVersion, 1);
  assert.equal(plan.setupPort, 8080);
  assert.deepEqual(plan.phases.map((phase) => phase.id), ['substrate', 'assets', 'handoff']);
  assert.deepEqual(plan.commands.map((command) => command.id), [
    'ensure-k3s',
    'wait-kubernetes-api',
    'import-control-plane-images',
    'apply-local-storage',
    'apply-control-plane',
    'report-setup-url',
    'report-fallback-command'
  ]);

  assert.equal(plan.paths.localPathStorageManifest, '/opt/alga-appliance/manifests/local-path-storage.yaml');
  assert.equal(plan.paths.controlPlaneManifestDir, '/opt/alga-appliance/control-plane/manifests');
  assert.equal(plan.paths.controlPlaneImageDir, '/opt/alga-appliance/control-plane/images');

  assert.equal(plan.commands.every((command) => command.idempotent), true);
  assert.equal(plan.commands.every((command) => command.requiresNetwork === false), true);
  assert.equal(assertHostBootstrapBoundary(plan), true);

  for (const responsibility of CONTROL_PLANE_RESPONSIBILITIES) {
    assert.equal(
      plan.commands.some((command) => command.action === responsibility),
      false,
      `${responsibility} must remain in the Kubernetes-hosted control plane`
    );
    assert.equal(plan.forbiddenHostResponsibilities.includes(responsibility), true);
  }
});

test('host bootstrap boundary rejects app setup work and pre-UI network dependencies', () => {
  const plan = buildHostBootstrapPlan();

  assert.throws(
    () => assertHostBootstrapBoundary({
      ...plan,
      commands: [
        ...plan.commands,
        {
          id: 'bad-bootstrap',
          phase: 'assets',
          action: 'trigger-application-bootstrap',
          idempotent: true,
          requiresNetwork: false
        }
      ]
    }),
    /crosses the control-plane boundary/
  );

  assert.throws(
    () => assertHostBootstrapBoundary({
      ...plan,
      commands: plan.commands.map((command) => command.id === 'apply-control-plane'
        ? { ...command, requiresNetwork: true }
        : command)
    }),
    /requires network before setup UI/
  );
});
