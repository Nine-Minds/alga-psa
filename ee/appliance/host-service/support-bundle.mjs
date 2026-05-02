#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';
const DEFAULT_OUTPUT_DIR = '/var/lib/alga-appliance/support-bundles';

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function shellRun(command) {
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf8', env: process.env });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1
  };
}

function redactText(value) {
  return String(value)
    .replace(/(token\s*[:=]\s*)([^\s"']+)/ig, '$1[REDACTED]')
    .replace(/(password\s*[:=]\s*)([^\s"']+)/ig, '$1[REDACTED]')
    .replace(/(client-key-data\s*:\s*)([^\s"']+)/ig, '$1[REDACTED]')
    .replace(/(authorization\s*:\s*bearer\s+)([^\s"']+)/ig, '$1[REDACTED]');
}

function writeRedactedFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  fs.writeFileSync(file, `${redactText(content)}\n`, { mode: 0o600 });
}

function readIfExists(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, 'utf8');
}

function captureCommand(file, command, runCommand = shellRun) {
  const result = runCommand(command);
  const summary = [`$ ${command}`, '', result.stdout, result.stderr].filter(Boolean).join('\n');
  writeRedactedFile(file, summary.trim());
  return result.ok;
}

export function generateSupportBundle(options = {}) {
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
  const stateFile = options.stateFile || '/var/lib/alga-appliance/install-state.json';
  const releaseSelectionFile = options.releaseSelectionFile || '/etc/alga-appliance/release-selection.json';
  const setupInputsFile = options.setupInputsFile || '/etc/alga-appliance/setup-inputs.json';
  const runCommand = options.runCommand || shellRun;
  const tempDir = options.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'alga-ubuntu-support-'));

  fs.mkdirSync(tempDir, { recursive: true, mode: 0o750 });
  fs.mkdirSync(path.join(tempDir, 'host'), { recursive: true, mode: 0o750 });
  fs.mkdirSync(path.join(tempDir, 'cluster'), { recursive: true, mode: 0o750 });
  fs.mkdirSync(path.join(tempDir, 'meta'), { recursive: true, mode: 0o750 });

  writeRedactedFile(path.join(tempDir, 'meta', 'summary.txt'), [
    `generatedAt=${new Date().toISOString()}`,
    `kubeconfigPath=${kubeconfigPath}`,
    `stateFile=${stateFile}`,
    `releaseSelectionFile=${releaseSelectionFile}`
  ].join('\n'));

  const maybeFiles = [
    [stateFile, path.join(tempDir, 'meta', 'install-state.json')],
    [releaseSelectionFile, path.join(tempDir, 'meta', 'release-selection.json')],
    [setupInputsFile, path.join(tempDir, 'meta', 'setup-inputs.json')]
  ];
  for (const [src, dest] of maybeFiles) {
    const content = readIfExists(src);
    if (content != null) {
      writeRedactedFile(dest, content);
    }
  }

  captureCommand(path.join(tempDir, 'host', 'appliance-journal.txt'), 'journalctl -u alga-appliance.service -u alga-appliance-console.service -n 800 --no-pager', runCommand);
  captureCommand(path.join(tempDir, 'host', 'k3s-service-status.txt'), 'systemctl status k3s --no-pager', runCommand);
  captureCommand(path.join(tempDir, 'host', 'disk-usage.txt'), 'df -h', runCommand);
  captureCommand(path.join(tempDir, 'host', 'ip-addresses.txt'), 'ip addr', runCommand);
  captureCommand(path.join(tempDir, 'host', 'routes.txt'), 'ip route', runCommand);
  captureCommand(path.join(tempDir, 'host', 'resolv-conf.txt'), 'cat /etc/resolv.conf', runCommand);
  captureCommand(path.join(tempDir, 'host', 'dns-lookup-github.txt'), 'getent hosts raw.githubusercontent.com', runCommand);
  captureCommand(path.join(tempDir, 'host', 'dns-lookup-ghcr.txt'), 'getent hosts ghcr.io', runCommand);
  captureCommand(path.join(tempDir, 'host', 'https-github.txt'), 'curl -I --max-time 10 https://raw.githubusercontent.com', runCommand);
  captureCommand(path.join(tempDir, 'host', 'https-ghcr.txt'), 'curl -I --max-time 10 https://ghcr.io/v2/', runCommand);

  const k = `kubectl --kubeconfig ${kubeconfigPath}`;
  captureCommand(path.join(tempDir, 'cluster', 'version.txt'), `${k} version`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'nodes.txt'), `${k} get nodes -o wide`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'namespaces.txt'), `${k} get namespaces`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'pods.txt'), `${k} get pods -A -o wide`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'deployments.txt'), `${k} get deployments -A`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'statefulsets.txt'), `${k} get statefulsets -A`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'jobs.txt'), `${k} get jobs -A`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'pvcs.txt'), `${k} get pvc -A`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'events.txt'), `${k} get events -A --sort-by=.lastTimestamp`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'flux-sources.txt'), `${k} -n flux-system get gitrepositories.source.toolkit.fluxcd.io -o yaml`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'flux-kustomizations.txt'), `${k} -n flux-system get kustomizations.kustomize.toolkit.fluxcd.io -o yaml`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'helmreleases.txt'), `${k} -n alga-system get helmreleases.helm.toolkit.fluxcd.io -o yaml`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'bootstrap-jobs.txt'), `${k} -n msp get jobs -o wide`, runCommand);
  captureCommand(path.join(tempDir, 'cluster', 'bootstrap-job-logs.txt'), `${k} -n msp logs jobs/alga-bootstrap --tail=400`, runCommand);

  fs.mkdirSync(outputDir, { recursive: true, mode: 0o750 });
  const bundlePath = path.join(outputDir, `alga-appliance-support-${nowStamp()}.tar.gz`);
  const tarResult = runCommand(`tar -C ${tempDir} -czf ${bundlePath} .`);
  if (!tarResult.ok) {
    return {
      ok: false,
      phase: 'support-bundle',
      message: 'Failed to create support bundle archive.',
      suspectedCause: tarResult.stderr.trim() || tarResult.stdout.trim() || 'tar failed',
      suggestedNextStep: 'Verify output directory permissions and tar availability, then retry.',
      retrySafe: true
    };
  }

  return {
    ok: true,
    phase: 'support-bundle',
    message: 'Support bundle generated successfully.',
    bundlePath,
    redaction: 'Token/password/client-key values are redacted from captured text output.'
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kubeconfig') {
      parsed.kubeconfigPath = argv[i + 1];
      i += 1;
    } else if (arg === '--output-dir') {
      parsed.outputDir = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const result = generateSupportBundle(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}
