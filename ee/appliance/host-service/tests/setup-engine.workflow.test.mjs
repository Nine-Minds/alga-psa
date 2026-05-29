import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFluxSource, applyReleaseSelectionConfiguration, applyRuntimeValuesAndReleaseSelection, installFlux, resolveChannelMetadata } from '../setup-engine.mjs';

const initialTenant = {
  tenantName: 'Acme MSP',
  adminFirstName: 'Ava',
  adminLastName: 'Admin',
  adminEmail: 'ava@example.com',
  adminPassword: 'Str0ng!Pass'
};

// A release manifest in the registry-metadata shape, injected via
// releaseManifestOverride so tests never touch the network or git. Per-service
// profile values are carried in the manifest (profileValues), as published.
function makeReleaseManifest(overrides = {}) {
  return {
    schema: 'alga.appliance.release/v1',
    version: '1.2.3',
    valuesProfile: 'single-node',
    images: { algaCore: 'coretag', workflowWorker: 'workertag', emailService: 'emailtag', temporalWorker: 'twtag' },
    controlPlane: 'cptag',
    config: { repository: 'ghcr.io/nine-minds/alga-appliance-config', tag: '1.2.3', digest: 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' },
    charts: { sebastian: '0.0.1', temporal: '0.1.0', 'temporal-worker': '0.1.0', 'workflow-worker': '0.1.0', 'email-service': '0.1.0' },
    profileValues: {
      'alga-core.single-node.yaml': 'appUrl: ""\nhost: ""\ndomainSuffix: ""\nbootstrap:\n  mode: fresh\nsetup:\n  image:\n    tag: old\nserver:\n  image:\n    tag: old\n',
      'pgbouncer.single-node.yaml': 'pgbouncer: packaged\n',
      'temporal.single-node.yaml': 'temporal: packaged\n',
      'workflow-worker.single-node.yaml': 'workflow-worker: packaged\nimage:\n  tag: old\nextraEnv:\n  - name: TEMPORAL_ADDRESS\n    value: temporal-frontend.msp.svc.cluster.local:7233\n',
      'email-service.single-node.yaml': 'email-service: packaged\nimage:\n  tag: old\n',
      'temporal-worker.single-node.yaml': 'temporal-worker: packaged\nimage:\n  tag: old\n'
    },
    ...overrides
  };
}

test('installFlux records success when flux install command exits cleanly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-flux-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const marker = path.join(tmp, 'flux-ok.txt');

  const result = installFlux({
    stateFile,
    kubeconfigPath: path.join(tmp, 'k3s.yaml'),
    fluxInstallCommand: `printf 'ok' > ${marker}`
  });

  assert.equal(result.ok, true);
  assert.equal(result.phase, 'flux');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');

  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.status, 'flux-install-complete');
  assert.equal(persisted.phase, 'flux');
});

test('resolveChannelMetadata resolves a channel to the registry release manifest', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-release-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');

  const result = await resolveChannelMetadata({ channel: 'stable' }, {
    stateFile,
    releaseManifestOverride: makeReleaseManifest()
  });

  assert.equal(result.ok, true);
  assert.equal(result.channel, 'stable');
  assert.equal(result.releaseVersion, '1.2.3');
  assert.equal(result.manifest.images.algaCore, 'coretag');
  assert.equal(result.manifest.config.digest, 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.status, 'release-resolve-complete');
  assert.equal(persisted.phase, 'registry-release-source');
});

test('resolveChannelMetadata rejects a malformed manifest', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-release-bad-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');

  const result = await resolveChannelMetadata({ channel: 'stable' }, {
    stateFile,
    // missing images.algaCore + config -> invalid
    releaseManifestOverride: { version: '9.9.9' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.step, 'resolve-release-manifest');
});

test('applyFluxSource emits an OCIRepository pinned to the config bundle digest (no GitRepository)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-flux-source-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const manifestPath = path.join(tmp, 'manifest.yaml');

  const releaseSelection = await resolveChannelMetadata({ channel: 'stable' }, {
    stateFile,
    releaseManifestOverride: makeReleaseManifest()
  });
  assert.equal(releaseSelection.ok, true);

  const result = applyFluxSource({ channel: 'stable' }, releaseSelection, {
    stateFile,
    fluxSourceApplyCommand: `cat > ${manifestPath}`
  });

  assert.equal(result.ok, true);
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  assert.match(manifest, /kind: OCIRepository/);
  assert.match(manifest, /url: oci:\/\/ghcr\.io\/nine-minds\/alga-appliance-config/);
  assert.match(manifest, /digest: sha256:deadbeef/);
  assert.match(manifest, /kind: OCIRepository\n {4}name: alga-appliance/);
  assert.doesNotMatch(manifest, /GitRepository/);
  assert.doesNotMatch(manifest, /branch:/);
});

test('applyRuntimeValuesAndReleaseSelection renders runtime values from the manifest (registry-metadata)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-runtime-values-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const runtimeValuesDir = path.join(tmp, 'runtime');
  const binDir = path.join(tmp, 'bin');
  const oldPath = process.env.PATH;

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'kubectl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}:${oldPath}`;

  try {
    const result = await applyRuntimeValuesAndReleaseSelection({
      channel: 'stable',
      appHostname: 'psa.example.test',
      initialTenant
    }, {
      ok: true,
      releaseVersion: '1.2.3'
    }, {
      stateFile,
      runtimeValuesDir,
      releaseManifestOverride: makeReleaseManifest(),
      kubeconfigPath: path.join(tmp, 'k3s.yaml'),
      tokenFile: path.join(tmp, 'setup-token')
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const renderedKustomization = fs.readFileSync(path.join(runtimeValuesDir, 'kustomization.yaml'), 'utf8');
    assert.match(renderedKustomization, /workflow-worker\.single-node\.yaml=values\/workflow-worker\.single-node\.yaml/);
    const renderedWorkflowValues = fs.readFileSync(path.join(runtimeValuesDir, 'values', 'workflow-worker.single-node.yaml'), 'utf8');
    assert.match(renderedWorkflowValues, /workflow-worker: packaged/);
    assert.match(renderedWorkflowValues, /TEMPORAL_ADDRESS/);
    // image tag from the manifest is injected into the alga-core values
    const renderedCoreValues = fs.readFileSync(path.join(runtimeValuesDir, 'values', 'alga-core.single-node.yaml'), 'utf8');
    assert.match(renderedCoreValues, /tag: "coretag"/);
    const initialTenantSecret = fs.readFileSync(path.join(runtimeValuesDir, 'initial-tenant-secret.yaml'), 'utf8');
    assert.match(initialTenantSecret, /name: appliance-initial-tenant/);
    assert.match(initialTenantSecret, /INITIAL_ADMIN_EMAIL: "ava@example.com"/);
    assert.match(initialTenantSecret, /INITIAL_ADMIN_PASSWORD: "Str0ng!Pass"/);
    const persistedState = fs.readFileSync(stateFile, 'utf8');
    assert.doesNotMatch(persistedState, /Str0ng!Pass/);
  } finally {
    process.env.PATH = oldPath;
  }
});

test('applyReleaseSelectionConfiguration persists selected release and runtime values', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-release-config-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const releaseSelectionFile = path.join(tmp, 'etc', 'release-selection.json');

  const result = applyReleaseSelectionConfiguration({
    channel: 'stable',
    appHostname: 'psa.example.com',
    dnsMode: 'system',
    dnsServers: ''
  }, {
    ok: true,
    channel: 'stable',
    releaseVersion: '1.2.3',
    registryHost: 'ghcr.io',
    repository: 'nine-minds/alga-appliance-release',
    manifestDigest: 'sha256:abc'
  }, {
    stateFile,
    releaseSelectionFile
  });

  assert.equal(result.ok, true);
  const persistedConfig = JSON.parse(fs.readFileSync(releaseSelectionFile, 'utf8'));
  assert.equal(persistedConfig.selectedChannel, 'stable');
  assert.equal(persistedConfig.selectedReleaseVersion, '1.2.3');
  assert.equal(persistedConfig.registryHost, 'ghcr.io');
  assert.equal(persistedConfig.runtime.appHostname, 'psa.example.com');

  const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persistedState.status, 'release-config-complete');
});
