#!/usr/bin/env node
// Single-node tuning for the Flux controllers that `flux install` deploys.
//
// Upstream Flux runs every controller with `--enable-leader-election` (lease
// duration 35s, renew deadline 30s, retry 5s). That exists for multi-replica
// HA; the appliance runs exactly one replica of each controller. On a slow
// appliance the k3s SQLite datastore can stall API requests for longer than the
// 30s renew deadline, so each stall made every controller lose its lease and
// exit 1 ("leader election lost"), then restart and re-list everything — which
// loads the stalled API server even harder. A field box showed 45-49 restarts
// per controller in 13 days. Leader election also costs a lease write every
// few seconds per controller against that same datastore.
//
// With one replica there is nothing to elect, so disable it. The only time two
// controller pods can coexist is during a rollout, so switch every controller
// to the Recreate strategy at the same time (source-controller already ships
// with Recreate): the old pod is fully gone before the new one starts, which
// rules out two helm-controllers running Helm operations at once.
//
// Run after every `flux install` (setup-engine installFlux) and on every
// control-plane start (control-plane-entrypoint.sh), so existing appliances
// pick it up with a control-plane update. Idempotent: an already-tuned
// Deployment is left untouched (no rollout).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const FLUX_NAMESPACE = 'flux-system';

// The controllers `flux install` deploys by default (no image automation).
export const APPLIANCE_FLUX_CONTROLLERS = Object.freeze([
  'source-controller',
  'kustomize-controller',
  'helm-controller',
  'notification-controller'
]);

const LEADER_ELECTION_FLAG = '--enable-leader-election';
export const LEADER_ELECTION_DISABLED_ARG = `${LEADER_ELECTION_FLAG}=false`;
const FLUX_CONTAINER_NAME = 'manager';

function isLeaderElectionArg(arg) {
  return arg === LEADER_ELECTION_FLAG || String(arg).startsWith(`${LEADER_ELECTION_FLAG}=`);
}

export function tunedControllerArgs(args = []) {
  return [...args.filter((arg) => !isLeaderElectionArg(arg)), LEADER_ELECTION_DISABLED_ARG];
}

function managerContainerIndex(deployment) {
  const containers = deployment?.spec?.template?.spec?.containers || [];
  const index = containers.findIndex((container) => container.name === FLUX_CONTAINER_NAME);
  if (index >= 0) return index;
  if (containers.length === 1) return 0;
  throw new Error(
    `Deployment ${deployment?.metadata?.name || '<unknown>'} has no "${FLUX_CONTAINER_NAME}" container `
    + `(containers: ${containers.map((c) => c.name).join(', ') || 'none'}); refusing to guess which one to tune.`
  );
}

// JSON patch that applies the single-node tuning, or null when the Deployment
// already has it. The `test` ops make the patch fail instead of clobbering args
// if the Deployment changed between our read and the patch.
export function fluxControllerTuningPatch(deployment) {
  const index = managerContainerIndex(deployment);
  const container = deployment.spec.template.spec.containers[index];
  const args = container.args || [];
  const desiredArgs = tunedControllerArgs(args);
  const argsTuned = JSON.stringify(args) === JSON.stringify(desiredArgs);
  const strategyTuned = deployment.spec?.strategy?.type === 'Recreate' && !deployment.spec.strategy.rollingUpdate;
  if (argsTuned && strategyTuned) return null;

  const containerPath = `/spec/template/spec/containers/${index}`;
  const patch = [{ op: 'test', path: `${containerPath}/name`, value: container.name }];
  // Strategy first: both ops land in one Deployment update, so the args
  // rollout itself already runs with Recreate.
  if (!strategyTuned) patch.push({ op: deployment.spec?.strategy ? 'replace' : 'add', path: '/spec/strategy', value: { type: 'Recreate' } });
  if (!argsTuned) {
    if (container.args) patch.push({ op: 'test', path: `${containerPath}/args`, value: args });
    patch.push({ op: container.args ? 'replace' : 'add', path: `${containerPath}/args`, value: desiredArgs });
  }
  return patch;
}

function defaultRunKubectl(kubeconfigPath, timeoutMs) {
  return (args) => {
    const result = spawnSync('kubectl', ['--kubeconfig', kubeconfigPath, `--request-timeout=${Math.ceil(timeoutMs / 1000)}s`, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs + 5_000
    });
    return {
      ok: result.status === 0,
      status: result.status ?? 1,
      stdout: result.stdout || '',
      stderr: result.stderr || (result.error ? result.error.message : '')
    };
  };
}

function isNotFound(result) {
  return /NotFound|not found/i.test(`${result.stderr}\n${result.stdout}`);
}

// Returns { ok, controllers: [{ name, action: 'patched'|'unchanged'|'absent'|'failed', error? }] }.
// `absent` (Flux not installed yet, e.g. a fresh box before setup) is not a failure.
export function tuneFluxControllers({
  kubeconfigPath,
  namespace = FLUX_NAMESPACE,
  controllers = APPLIANCE_FLUX_CONTROLLERS,
  timeoutMs = 30_000,
  runKubectl = defaultRunKubectl(kubeconfigPath, timeoutMs)
} = {}) {
  const results = [];
  for (const name of controllers) {
    const read = runKubectl(['-n', namespace, 'get', 'deployment', name, '-o', 'json']);
    if (!read.ok) {
      results.push(isNotFound(read)
        ? { name, action: 'absent' }
        : { name, action: 'failed', error: (read.stderr || read.stdout || `kubectl exited ${read.status}`).trim() });
      continue;
    }
    let patch;
    try {
      patch = fluxControllerTuningPatch(JSON.parse(read.stdout));
    } catch (error) {
      results.push({ name, action: 'failed', error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!patch) {
      results.push({ name, action: 'unchanged' });
      continue;
    }
    const applied = runKubectl(['-n', namespace, 'patch', 'deployment', name, '--type=json', '-p', JSON.stringify(patch)]);
    results.push(applied.ok
      ? { name, action: 'patched' }
      : { name, action: 'failed', error: (applied.stderr || applied.stdout || `kubectl exited ${applied.status}`).trim() });
  }
  return { ok: results.every((result) => result.action !== 'failed'), controllers: results };
}

export function describeTuningResult(result) {
  return result.controllers
    .map((c) => `${c.name}: ${c.action}${c.error ? ` (${c.error})` : ''}`)
    .join('; ');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const kubeconfigPath = arg('kubeconfig', process.env.ALGA_APPLIANCE_KUBECONFIG || '/etc/rancher/k3s/k3s.yaml');
  const attempts = Math.max(1, Number(arg('attempts', '1')));
  const retryDelayMs = Number(arg('retry-delay-ms', '30000'));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = tuneFluxControllers({ kubeconfigPath });
    const line = `[flux-controller-tuning] ${new Date().toISOString()} attempt ${attempt}/${attempts}: ${describeTuningResult(result)}`;
    if (result.ok) {
      process.stdout.write(`${line}\n`);
      return 0;
    }
    process.stderr.write(`${line}\n`);
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(`[flux-controller-tuning] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
