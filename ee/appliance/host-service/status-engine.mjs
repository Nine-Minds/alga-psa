#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const DEFAULT_STATE_FILE = '/var/lib/alga-appliance/install-state.json';
const DEFAULT_KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';

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

function runCommand(command) {
  const result = spawnSync('sh', ['-c', command], {
    env: process.env,
    encoding: 'utf8'
  });

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

export function collectStatusSnapshot(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const kubectlPrefix = options.kubectlPrefix || `kubectl --kubeconfig ${kubeconfigPath}`;

  const installState = readJsonFile(stateFile);
  const nodeResult = runCommand(`${kubectlPrefix} get nodes -o json`);
  const podResult = runCommand(`${kubectlPrefix} get pods -A --no-headers`);

  let nodes = [];
  if (nodeResult.ok) {
    try {
      const parsed = JSON.parse(nodeResult.stdout);
      nodes = (parsed.items || []).map((item) => ({
        name: item.metadata?.name || 'unknown',
        ready: (item.status?.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True')
      }));
    } catch {
      nodes = [];
    }
  }

  const podLines = podResult.ok
    ? podResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];

  return {
    source: 'ubuntu-host-service',
    installState,
    currentPhase: installState?.phase || 'setup',
    status: installState?.status || 'unknown',
    kubeconfigPath,
    kubernetes: {
      nodes,
      podCount: podLines.length,
      warnings: [
        ...(nodeResult.ok ? [] : [`node query failed: ${nodeResult.stderr.trim() || nodeResult.stdout.trim() || 'unknown error'}`]),
        ...(podResult.ok ? [] : [`pod query failed: ${podResult.stderr.trim() || podResult.stdout.trim() || 'unknown error'}`])
      ]
    }
  };
}
