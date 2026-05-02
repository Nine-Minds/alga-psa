import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { persistMaintenanceMetadata } from '../metadata-engine.mjs';

test('persistMaintenanceMetadata writes v1 manual update posture and app metadata', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-maint-meta-'));
  const metadataFile = path.join(tmp, 'maintenance-metadata.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  const installStateFile = path.join(tmp, 'install-state.json');
  const osReleaseFile = path.join(tmp, 'os-release');

  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    selectedChannel: 'stable',
    selectedReleaseVersion: '1.2.3',
    repoUrl: 'https://github.com/Nine-Minds/alga-psa',
    repoBranch: 'main'
  }));
  fs.writeFileSync(installStateFile, JSON.stringify({ status: 'update-complete', phase: 'github-release-source' }));
  fs.writeFileSync(osReleaseFile, 'ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n');

  const result = persistMaintenanceMetadata({
    metadataFile,
    releaseSelectionFile,
    installStateFile,
    osReleaseFile,
    k3sVersionCommand: "printf 'k3s version v1.31.4+k3s1'"
  });

  assert.equal(result.ok, true);
  const persisted = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  assert.equal(persisted.host.updatePolicy, 'manual-support-run-v1');
  assert.equal(persisted.k3s.updatePolicy, 'manual-support-run-v1');
  assert.equal(persisted.app.selectedReleaseVersion, '1.2.3');
  assert.equal(typeof persisted.app.lastAppUpdateAt, 'string');
});
