import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAppChannelUpdate } from '../update-engine.mjs';

test('runAppChannelUpdate applies channel update and persists history without OS/k3s mutation scope', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-update-engine-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  const updateHistoryFile = path.join(tmp, 'update-history.json');
  const metadataFile = path.join(tmp, 'maintenance-metadata.json');
  const fluxManifestPath = path.join(tmp, 'flux-source.yaml');

  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    repoUrl: 'https://github.com/Nine-Minds/alga-psa.git',
    repoBranch: 'main',
    runtime: { appHostname: 'psa.example.com', dnsMode: 'system', dnsServers: '' }
  }));

  const result = await runAppChannelUpdate({ channel: 'nightly' }, {
    stateFile,
    releaseSelectionFile,
    updateHistoryFile,
    channelMetadataOverride: {
      releaseVersion: '2.0.0-nightly.1',
      repoBranch: 'main'
    },
    fluxSourceApplyCommand: `cat > ${fluxManifestPath}`,
    reconcileSourceCommand: 'true',
    reconcileHelmCommand: 'true',
    metadataFile,
    osReleaseFile: path.join(tmp, 'os-release'),
    k3sVersionCommand: "printf 'k3s version v1.31.4+k3s1'"
  });

  assert.equal(result.ok, true);
  assert.equal(result.selectedChannel, 'nightly');
  assert.equal(result.updateScope, 'application-only');

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'update-complete');
  assert.equal(state.update.scope, 'application-only');

  const releaseSelection = JSON.parse(fs.readFileSync(releaseSelectionFile, 'utf8'));
  assert.equal(releaseSelection.selectedChannel, 'nightly');
  assert.equal(releaseSelection.selectedReleaseVersion, '2.0.0-nightly.1');

  const history = JSON.parse(fs.readFileSync(updateHistoryFile, 'utf8'));
  assert.equal(Array.isArray(history.history), true);
  assert.equal(history.history[0].ok, true);

  const fluxManifest = fs.readFileSync(fluxManifestPath, 'utf8');
  assert.match(fluxManifest, /kind: GitRepository/);
});
