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

test('resolveChannelMetadata uses channel release fields from GitHub schema', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-release-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');

  const result = await resolveChannelMetadata({
    channel: 'stable',
    repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
    repoBranch: ''
  }, {
    stateFile,
    channelMetadataOverride: {
      channel: 'stable',
      releaseVersion: '1.0-rc5.1',
      repoBranch: 'release/1.0-rc5'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.releaseVersion, '1.0-rc5.1');
  assert.equal(result.repoBranch, 'release/1.0-rc5');
});

test('resolveChannelMetadata honors support repoBranch override over channel branch', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-release-override-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');

  const result = await resolveChannelMetadata({
    channel: 'stable',
    repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
    repoBranch: 'feature/on-premise-email-processing'
  }, {
    stateFile,
    channelMetadataOverride: {
      channel: 'stable',
      releaseVersion: '1.0-rc5.1',
      repoBranch: 'release/1.0-rc5'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.releaseVersion, '1.0-rc5.1');
  assert.equal(result.repoBranch, 'feature/on-premise-email-processing');
});

test('applyFluxSource applies the resolved support branch override to Flux', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-flux-source-override-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const manifestPath = path.join(tmp, 'manifest.yaml');
  const inputs = {
    channel: 'stable',
    repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
    repoBranch: 'feature/on-premise-email-processing'
  };

  const releaseSelection = await resolveChannelMetadata(inputs, {
    stateFile,
    channelMetadataOverride: {
      channel: 'stable',
      releaseVersion: '1.0-rc5.1',
      repoBranch: 'release/1.0-rc5'
    }
  });
  assert.equal(releaseSelection.ok, true);

  const result = applyFluxSource(inputs, releaseSelection, {
    stateFile,
    fluxSourceApplyCommand: `cat > ${manifestPath}`
  });

  assert.equal(result.ok, true);
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  assert.match(manifest, /branch: feature\/on-premise-email-processing/);
  assert.doesNotMatch(manifest, /branch: release\/1\.0-rc5/);
});

test('applyFluxSource normalizes SSH GitHub URL to HTTPS for Flux source', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-flux-source-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const manifestPath = path.join(tmp, 'manifest.yaml');

  const result = applyFluxSource({
    channel: 'stable',
    repoUrl: 'git@github.com:Nine-Minds/alga-psa.git',
    repoBranch: 'main'
  }, {
    ok: true,
    repoUrl: 'git@github.com:Nine-Minds/alga-psa.git',
    repoBranch: 'main',
    releaseVersion: '1.0-rc5.1'
  }, {
    stateFile,
    fluxSourceApplyCommand: `cat > ${manifestPath}`
  });

  assert.equal(result.ok, true);
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  assert.ok(manifest.includes('url: https://github.com/Nine-Minds/alga-psa'));
});

test('applyRuntimeValuesAndReleaseSelection renders runtime values from injected metadata (no baked files)', async () => {
  // Release metadata has a single source of truth (git on the configured branch).
  // Tests inject it via the *Override options instead of any baked local files.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-runtime-values-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const runtimeValuesDir = path.join(tmp, 'runtime');
  const binDir = path.join(tmp, 'bin');
  const oldPath = process.env.PATH;

  const releaseManifestOverride = {
    app: {
      version: '1.2.3',
      releaseBranch: 'release/offline',
      valuesProfile: 'single-node',
      images: { algaCore: 'coretag', workflowWorker: 'workertag', emailService: 'emailtag', temporalWorker: 'twtag' }
    }
  };

  const profileValuesOverride = {
    'alga-core.single-node.yaml': 'appUrl: ""\nhost: ""\ndomainSuffix: ""\nbootstrap:\n  mode: fresh\nsetup:\n  image:\n    tag: old\nserver:\n  image:\n    tag: old\n',
    'pgbouncer.single-node.yaml': 'pgbouncer: packaged\n',
    'temporal.single-node.yaml': 'temporal: packaged\n',
    'workflow-worker.single-node.yaml': 'workflow-worker: packaged\nimage:\n  tag: old\nextraEnv:\n  - name: TEMPORAL_ADDRESS\n    value: temporal-frontend.msp.svc.cluster.local:7233\n',
    'email-service.single-node.yaml': 'email-service: packaged\nimage:\n  tag: old\n',
    'temporal-worker.single-node.yaml': 'temporal-worker: packaged\nimage:\n  tag: old\n'
  };

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'kubectl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}:${oldPath}`;

  try {
    const result = await applyRuntimeValuesAndReleaseSelection({
      channel: 'stable',
      repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
      repoBranch: 'main',
      appHostname: 'psa.example.test',
      initialTenant
    }, {
      ok: true,
      releaseVersion: '1.2.3',
      repoBranch: 'release/offline'
    }, {
      stateFile,
      runtimeValuesDir,
      releaseManifestOverride,
      profileValuesOverride,
      kubeconfigPath: path.join(tmp, 'k3s.yaml'),
      tokenFile: path.join(tmp, 'setup-token')
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const renderedKustomization = fs.readFileSync(path.join(runtimeValuesDir, 'kustomization.yaml'), 'utf8');
    assert.match(renderedKustomization, /workflow-worker\.single-node\.yaml=values\/workflow-worker\.single-node\.yaml/);
    const renderedWorkflowValues = fs.readFileSync(path.join(runtimeValuesDir, 'values', 'workflow-worker.single-node.yaml'), 'utf8');
    assert.match(renderedWorkflowValues, /workflow-worker: packaged/);
    assert.match(renderedWorkflowValues, /TEMPORAL_ADDRESS/);
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
    releaseVersion: '1.0-rc5.1',
    repoUrl: 'https://github.com/Nine-Minds/alga-psa',
    repoBranch: 'release/1.0-rc5'
  }, {
    stateFile,
    releaseSelectionFile
  });

  assert.equal(result.ok, true);
  const persistedConfig = JSON.parse(fs.readFileSync(releaseSelectionFile, 'utf8'));
  assert.equal(persistedConfig.selectedChannel, 'stable');
  assert.equal(persistedConfig.selectedReleaseVersion, '1.0-rc5.1');
  assert.equal(persistedConfig.runtime.appHostname, 'psa.example.com');

  const persistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persistedState.status, 'release-config-complete');
});
