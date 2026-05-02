#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SETUP_FILE = '/etc/alga-appliance/setup-inputs.json';

export function validateSetupInputs(raw) {
  const channel = raw.channel || 'stable';
  const appHostname = raw.appHostname || '';
  const dnsMode = raw.dnsMode || 'system';
  const dnsServers = raw.dnsServers || '';
  const repoUrl = raw.repoUrl || 'https://github.com/Nine-Minds/alga-psa.git';
  const repoBranch = raw.repoBranch || '';

  if (!['stable', 'nightly'].includes(channel)) {
    throw new Error('Invalid channel. Use stable or nightly.');
  }

  if (!['system', 'custom'].includes(dnsMode)) {
    throw new Error('Invalid DNS mode. Use system or custom.');
  }

  return {
    channel,
    appHostname,
    dnsMode,
    dnsServers,
    repoUrl,
    repoBranch,
    submittedAt: new Date().toISOString()
  };
}

export function persistSetupInputs(inputs, setupInputsFile = DEFAULT_SETUP_FILE) {
  const setupDir = path.dirname(setupInputsFile);
  fs.mkdirSync(setupDir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(setupInputsFile, `${JSON.stringify(inputs, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(setupDir, 0o750);
  fs.chmodSync(setupInputsFile, 0o600);
}
