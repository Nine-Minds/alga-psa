import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFluxSource, applyReleaseSelectionConfiguration, ensureLocalPathStorage, installFlux, installK3sSingleNode, resolveChannelMetadata } from '../setup-engine.mjs';

test('installK3sSingleNode succeeds when installer command exits cleanly and kubeconfig exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-k3s-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const kubeconfigPath = path.join(tmp, 'k3s.yaml');

  const result = installK3sSingleNode({
    stateFile,
    kubeconfigPath,
    k3sVersion: 'v1.31.4+k3s1',
    installCommand: `cat > ${kubeconfigPath} <<'CFG'\napiVersion: v1\nclusters: []\ncontexts: []\nusers: []\nCFG\n`
  });

  assert.equal(result.ok, true);
  assert.equal(result.phase, 'k3s');
  assert.equal(result.kubeconfigPath, kubeconfigPath);

  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.status, 'k3s-install-complete');
  assert.equal(persisted.phase, 'k3s');
  assert.equal(persisted.k3s.kubeconfigPath, kubeconfigPath);
});

test('installK3sSingleNode defaults disable Traefik and ServiceLB', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-k3s-flags-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const kubeconfigPath = path.join(tmp, 'k3s.yaml');
  const execCapture = path.join(tmp, 'exec.txt');

  const result = installK3sSingleNode({
    stateFile,
    kubeconfigPath,
    installCommand: `printf '%s' \"$INSTALL_K3S_EXEC\" > ${execCapture}; cat > ${kubeconfigPath} <<'CFG'\napiVersion: v1\nclusters: []\ncontexts: []\nusers: []\nCFG\n`
  });

  assert.equal(result.ok, true);
  const installExec = fs.readFileSync(execCapture, 'utf8');
  assert.match(installExec, /--disable traefik/);
  assert.match(installExec, /--disable servicelb/);
});

test('ensureLocalPathStorage records success when installer command exits cleanly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-appliance-storage-'));
  const stateFile = path.join(tmp, 'state', 'install-state.json');
  const marker = path.join(tmp, 'storage-ok.txt');

  const result = ensureLocalPathStorage({
    stateFile,
    kubeconfigPath: path.join(tmp, 'k3s.yaml'),
    storageInstallCommand: `printf 'ok' > ${marker}`
  });

  assert.equal(result.ok, true);
  assert.equal(result.phase, 'storage');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');

  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.status, 'storage-config-complete');
  assert.equal(persisted.phase, 'storage');
});

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
    repoBranch: 'main'
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
