#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_METADATA_FILE = '/var/lib/alga-appliance/maintenance-metadata.json';

function nowIso() {
  return new Date().toISOString();
}

function readOsRelease(file = '/etc/os-release') {
  if (!fs.existsSync(file)) {
    return null;
  }
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const map = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx);
    const raw = line.slice(idx + 1).trim();
    map[key] = raw.replace(/^"|"$/g, '');
  }
  return {
    id: map.ID || null,
    versionId: map.VERSION_ID || null,
    prettyName: map.PRETTY_NAME || null
  };
}

function commandOutput(command) {
  const result = spawnSync('sh', ['-c', command], { env: process.env, encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout || '').trim() || null;
}

function writeSecureJsonFile(targetFile, value) {
  const dir = path.dirname(targetFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(targetFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(dir, 0o750);
  fs.chmodSync(targetFile, 0o600);
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function persistMaintenanceMetadata(options = {}) {
  const metadataFile = options.metadataFile || DEFAULT_METADATA_FILE;
  const releaseSelectionFile = options.releaseSelectionFile || '/etc/alga-appliance/release-selection.json';
  const installStateFile = options.installStateFile || '/var/lib/alga-appliance/install-state.json';
  const osReleaseFile = options.osReleaseFile || '/etc/os-release';
  const k3sVersionCommand = options.k3sVersionCommand || 'k3s --version | head -n1';

  const existing = readJsonFile(metadataFile) || {};
  const releaseSelection = readJsonFile(releaseSelectionFile) || {};
  const installState = readJsonFile(installStateFile) || {};
  const osInfo = readOsRelease(osReleaseFile);
  const k3sVersion = commandOutput(k3sVersionCommand);

  const payload = {
    updatedAt: nowIso(),
    host: {
      os: osInfo,
      updatePolicy: 'manual-support-run-v1',
      cveLiabilityNote: 'Ubuntu package and k3s updates are manual in v1; managed maintenance is planned for v2.'
    },
    k3s: {
      version: k3sVersion,
      updatePolicy: 'manual-support-run-v1'
    },
    app: {
      selectedChannel: releaseSelection.selectedChannel || releaseSelection.channel || null,
      selectedReleaseVersion: releaseSelection.selectedReleaseVersion || null,
      repoUrl: releaseSelection.repoUrl || null,
      repoBranch: releaseSelection.repoBranch || null,
      lastKnownInstallStatus: installState.status || null,
      lastKnownPhase: installState.phase || null,
      lastAppUpdateAt: existing.app?.lastAppUpdateAt || null
    },
    maintenance: {
      v2Direction: [
        'add managed maintenance windows',
        'preflight backup/snapshot checks',
        'validated k3s upgrade paths',
        'maintenance history and rollback guidance'
      ]
    }
  };

  if ((installState.status || '').startsWith('update-')) {
    payload.app.lastAppUpdateAt = nowIso();
  }

  writeSecureJsonFile(metadataFile, payload);
  return { ok: true, metadataFile, metadata: payload };
}
