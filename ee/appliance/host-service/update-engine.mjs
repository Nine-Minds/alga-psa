#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { applyFluxSource, applyReleaseSelectionConfiguration, applyRuntimeValuesAndReleaseSelection, installStorage, resolveChannelMetadata, validateReleaseManifest, validateSetupInputs } from './setup-engine.mjs';
import { persistMaintenanceMetadata } from './metadata-engine.mjs';
import { appendUpdateHistory, readJsonFile, writeSecureJsonFileAtomic } from './update-state.mjs';
import {
  APPLIANCE_HELM_RELEASES,
  BOOTSTRAP_HOOK_JOB,
  clearBootstrapHookJob,
  expectedChartVersions,
  forceHelmReleaseReconcile,
  isBootstrapHookCollision,
  nudgeChildKustomizations,
  readHelmRelease,
  setHelmReleasesSuspended
} from './helm-release-recovery.mjs';

const DEFAULT_STATE_FILE = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';
// release-selection.json lives in /var/lib/alga-appliance — the writable hostPath
// mount owned by the service uid (10001). /etc/alga-appliance is root-owned 0750,
// so an /etc default silently broke updates two ways: the write EACCES'd, and the
// read returned empty, which made the rebuild reset the app URL (NEXTAUTH_URL) to
// the placeholder host. Default to the real location; the env override still wins.
const DEFAULT_RELEASE_SELECTION_FILE = process.env.ALGA_APPLIANCE_RELEASE_SELECTION_FILE || '/var/lib/alga-appliance/release-selection.json';
const DEFAULT_UPDATE_HISTORY_FILE = process.env.ALGA_APPLIANCE_UPDATE_HISTORY_FILE || '/var/lib/alga-appliance/update-history.json';
// Honor the control plane's configured kubeconfig (the pod's in-cluster
// kubeconfig at /tmp/alga-appliance/kubeconfig), matching setup-engine/status-engine.
// Hardcoding the bare-host /etc/rancher/k3s/k3s.yaml made the flux/helm reconcile
// step fail in the pod with `stat /etc/rancher/k3s/k3s.yaml: no such file`.
const DEFAULT_KUBECONFIG = process.env.ALGA_APPLIANCE_KUBECONFIG || '/etc/rancher/k3s/k3s.yaml';

function nowIso() {
  return new Date().toISOString();
}

function writeInstallState(state, stateFile) {
  writeSecureJsonFileAtomic(stateFile, state);
}

function updateIntent(channel, owner, startedAt = owner?.startedAt) {
  return {
    requestedChannel: channel,
    scope: 'application-only',
    ...(startedAt ? { startedAt } : {}),
    ...(owner ? { owner } : {})
  };
}

function finishUpdateFailure(failure, context) {
  const at = nowIso();
  writeInstallState({
    status: 'update-blocked',
    phase: failure.phase,
    lastAction: failure.message,
    failure,
    updatedAt: at,
    update: updateIntent(context.channel, null, context.owner?.startedAt || context.startedAt)
  }, context.stateFile);
  appendUpdateHistory({
    at,
    channel: context.channel,
    ok: false,
    category: failure.category,
    phase: failure.phase,
    message: failure.message
  }, context.updateHistoryFile);
  return failure;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// kubectl runner in the shape helm-release-recovery.mjs expects
// ({ ok, stdout, stderr } per invocation), bound to the engine's kubeconfig.
function makeKubectlRunner(kubeconfigPath) {
  return async (args) => {
    const res = spawnSync('sh', ['-c', `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} ${args}`], { env: process.env, encoding: 'utf8' });
    return { ok: res.status === 0, status: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
  };
}

function runShell(command) {
  const res = spawnSync('sh', ['-c', command], { env: process.env, encoding: 'utf8' });
  return { ok: res.status === 0, status: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function fluxFailure(message, cause, suggestedNextStep, extra = {}) {
  return {
    ok: false,
    phase: 'flux',
    message,
    suspectedCause: cause,
    suggestedNextStep,
    retrySafe: true,
    ...extra
  };
}

// Tests (and dry runs) inject the manifest via releaseManifestOverride, the
// same way setup-engine's apply steps accept it.
function runtimeValuesManifest(options) {
  return validateReleaseManifest(options.releaseManifestOverride);
}

function releaseNames(options) {
  return (options.helmReleases || APPLIANCE_HELM_RELEASES).map((r) => r.name);
}

// Hold every appliance HelmRelease still while the update rewrites its inputs.
// Values (ConfigMaps) and chart pins (config bundle via the Flux Kustomization)
// arrive at different moments; suspended, helm-controller sees both at once
// when we resume and runs exactly one upgrade per release.
export async function suspendAppReleases(options = {}) {
  const runKubectl = options.runKubectl || makeKubectlRunner(options.kubeconfigPath || DEFAULT_KUBECONFIG);
  const result = await setHelmReleasesSuspended({ runKubectl, names: releaseNames(options), suspended: true });
  if (!result.ok) {
    return fluxFailure(
      'Could not suspend the application HelmReleases before applying the update.',
      result.failures.map((f) => `${f.name}: ${f.error}`).join('; '),
      'Check kubectl access to the alga-system namespace and retry the update.',
      { step: 'suspend-helmreleases' }
    );
  }
  return { ok: true, phase: 'flux', step: 'suspend-helmreleases', suspended: releaseNames(options) };
}

export async function resumeAppReleases(options = {}) {
  const runKubectl = options.runKubectl || makeKubectlRunner(options.kubeconfigPath || DEFAULT_KUBECONFIG);
  const result = await setHelmReleasesSuspended({ runKubectl, names: releaseNames(options), suspended: false });
  if (!result.ok) {
    return fluxFailure(
      'Could not resume the application HelmReleases after applying the update.',
      result.failures.map((f) => `${f.name}: ${f.error}`).join('; '),
      'Use Recover on the Manage page (it resumes the releases) or run `flux resume helmrelease --all -n alga-system`.',
      { step: 'resume-helmreleases' }
    );
  }
  return { ok: true, phase: 'flux', step: 'resume-helmreleases' };
}

// Confirm the config bundle actually reached the HelmReleases: each pinned
// chart version in the release manifest must be the HelmRelease's
// spec.chart.spec.version. Resuming before that would run an upgrade with the
// new values but the old chart — the second half of the double-upgrade race.
// The pins are written by the bundle's nested Kustomizations (see
// nudgeChildKustomizations), so this polls instead of checking once.
async function chartPinMismatches({ runKubectl, expected }) {
  const mismatches = [];
  for (const [name, version] of Object.entries(expected)) {
    if (!version) continue;
    const hr = await readHelmRelease({ runKubectl, name });
    if (hr.notFound || (!hr.readable && hr.error)) {
      mismatches.push(`${name}: ${hr.error || 'HelmRelease not readable'}`);
      continue;
    }
    if (hr.specChartVersion !== version) {
      mismatches.push(`${name}: chart version is ${hr.specChartVersion || 'unset'}, expected ${version}`);
    }
  }
  return mismatches;
}

async function waitForChartPins({ runKubectl, sleep, expected, timeoutMs, pollMs }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mismatches = await chartPinMismatches({ runKubectl, expected });
    if (mismatches.length === 0) return { ok: true };
    if (Date.now() >= deadline) return { ok: false, mismatches };
    await sleep(pollMs);
  }
}

// Poll the appliance HelmReleases until each is Ready for its current spec at
// the expected chart version. Returns { converged } | { pending } |
// { failed, name, summary }. A stall caused by the bootstrap hook Job
// collision is cleared and retried once (clear Job, force + reset reconcile).
async function waitForAppReleasesConverged({ runKubectl, sleep, expected, names, timeoutMs, pollMs, onProgress }) {
  const deadline = Date.now() + timeoutMs;
  let hookRetryDone = false;
  let lastProgress = '';
  for (;;) {
    const waiting = [];
    for (const name of names) {
      const hr = await readHelmRelease({ runKubectl, name });
      if (hr.notFound || (!hr.readable && hr.error)) {
        return { failed: true, name, summary: { message: hr.error || 'HelmRelease not readable', reason: 'Unreadable' } };
      }
      if (!hr.readable) {
        waiting.push(`${name} (no status yet)`);
        continue;
      }
      const atVersion = !expected[name] || hr.lastAttemptedRevision === expected[name];
      if (hr.observedCurrent && hr.ready && atVersion && !hr.suspended) continue;
      if (hr.hardFailed) {
        if (name === names[0] && !hookRetryDone && isBootstrapHookCollision(hr.message)) {
          hookRetryDone = true;
          onProgress?.(`Clearing the leftover ${BOOTSTRAP_HOOK_JOB.name} Job and retrying the ${name} upgrade.`);
          const cleared = await clearBootstrapHookJob({ runKubectl, sleep, waitForActiveMs: 0 });
          if (!cleared.ok) return { failed: true, name, summary: { message: cleared.error, reason: 'HookJobCleanupFailed' } };
          const forced = await forceHelmReleaseReconcile({ runKubectl, name });
          if (!forced.ok) return { failed: true, name, summary: { message: forced.error, reason: 'ForceReconcileFailed' } };
          waiting.push(`${name} (retrying after hook Job collision)`);
          continue;
        }
        return { failed: true, name, summary: hr };
      }
      waiting.push(`${name} (${hr.reason})`);
    }
    if (waiting.length === 0) return { converged: true };
    const progress = `Waiting for services to converge: ${waiting.join(', ')}`;
    if (progress !== lastProgress) {
      lastProgress = progress;
      onProgress?.(progress);
    }
    if (Date.now() >= deadline) return { pending: true, waiting };
    await sleep(pollMs);
  }
}

// Bring the update live: reconcile the OCI source and the Kustomization (chart
// pins), verify the pins landed, make sure no stale bootstrap hook Job can
// collide with the coming upgrade, resume the releases, and wait for all of
// them to reach Ready at the new chart version.
export async function reconcileFluxAndHelm(options = {}, context = {}) {
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const fluxSourceName = options.fluxSourceName || 'alga-appliance';
  const reconcileTimeout = options.reconcileTimeout || '15m';
  const runKubectl = options.runKubectl || makeKubectlRunner(kubeconfigPath);
  const sleep = options.sleep || sleepMs;
  const names = releaseNames(options);
  const expected = expectedChartVersions(context.manifest, options.helmReleases || APPLIANCE_HELM_RELEASES);
  const onProgress = context.onProgress || (() => {});

  const reconcileSourceCmd = options.reconcileSourceCommand
    || `flux --kubeconfig ${kubeconfigPath} reconcile source oci ${fluxSourceName} -n flux-system --timeout ${reconcileTimeout}`;
  const reconcileKustomizationCmd = options.reconcileKustomizationCommand
    || `flux --kubeconfig ${kubeconfigPath} reconcile kustomization ${fluxSourceName} -n flux-system --timeout ${reconcileTimeout}`;
  const reconcileHelmCmd = options.reconcileHelmCommand
    || `flux --kubeconfig ${kubeconfigPath} reconcile helmrelease ${names[0]} -n alga-system --with-source --timeout ${reconcileTimeout}`;

  onProgress('Reconciling the Flux config source.');
  const source = runShell(reconcileSourceCmd);
  if (!source.ok) {
    return fluxFailure(
      'Flux source reconcile failed during app update.',
      (source.stderr || source.stdout || '').trim() || `exit ${source.status}`,
      'Verify Flux source-controller health and OCIRepository readiness.',
      { step: 'reconcile-source' }
    );
  }

  onProgress('Applying the release config bundle (chart versions).');
  const kustomization = runShell(reconcileKustomizationCmd);
  if (!kustomization.ok) {
    return fluxFailure(
      'Flux Kustomization reconcile failed during app update.',
      (kustomization.stderr || kustomization.stdout || '').trim() || `exit ${kustomization.status}`,
      'Verify Flux kustomize-controller health and the alga-appliance Kustomization status.',
      { step: 'reconcile-kustomization' }
    );
  }

  onProgress('Waiting for the new chart versions to reach the HelmReleases.');
  await nudgeChildKustomizations({ runKubectl, parentName: fluxSourceName, parentNamespace: options.fluxNamespace || 'flux-system' });
  const pins = await waitForChartPins({
    runKubectl,
    sleep,
    expected,
    timeoutMs: options.chartPinTimeoutMs ?? 10 * 60_000,
    pollMs: options.convergePollMs ?? 5000
  });
  if (!pins.ok) {
    return fluxFailure(
      'The release config bundle did not update the HelmRelease chart versions.',
      pins.mismatches.join('; '),
      'Check the alga-core and alga-background Kustomizations (flux-system); if a release was already failed before this update, use Recover on the Manage page first, then retry.',
      { step: 'verify-chart-pins' }
    );
  }

  const hookJob = await clearBootstrapHookJob({ runKubectl, sleep, waitForActiveMs: options.hookJobWaitMs ?? 10 * 60_000, pollMs: options.convergePollMs ?? 5000 });
  if (!hookJob.ok) {
    return fluxFailure(
      `Could not clear the previous ${BOOTSTRAP_HOOK_JOB.name} Job before upgrading.`,
      hookJob.error,
      `Delete the Job (kubectl -n ${BOOTSTRAP_HOOK_JOB.namespace} delete job ${BOOTSTRAP_HOOK_JOB.name}) or use Recover, then retry.`,
      { step: 'clear-bootstrap-hook-job' }
    );
  }

  const resumed = await resumeAppReleases(options);
  if (!resumed.ok) return resumed;

  onProgress('Upgrading the application release.');
  // `flux reconcile helmrelease --with-source` kicks the reconcile and waits
  // for Ready; a non-zero exit is frequently transient (already reconciling,
  // wait timed out while the roll continues). The convergence wait below is
  // the judge, not the CLI's exit code.
  const helm = runShell(reconcileHelmCmd);
  const cliCause = helm.ok ? null : ((helm.stderr || helm.stdout || '').trim() || `exit ${helm.status}`);

  const outcome = await waitForAppReleasesConverged({
    runKubectl,
    sleep,
    expected,
    names,
    timeoutMs: options.convergeTimeoutMs ?? 20 * 60_000,
    pollMs: options.convergePollMs ?? 5000,
    onProgress
  });
  if (outcome.failed) {
    return fluxFailure(
      `HelmRelease ${outcome.name} failed during app update.`,
      outcome.summary.message || cliCause || outcome.summary.reason,
      'Use Recover on the Manage page, or inspect the HelmRelease events and helm-controller logs.',
      { step: 'wait-for-convergence', helmRelease: outcome.name }
    );
  }
  if (outcome.pending) {
    return {
      ok: true,
      phase: 'flux',
      pending: true,
      waiting: outcome.waiting,
      message: `Update applied; still converging in the background: ${outcome.waiting.join(', ')}.`
    };
  }
  return { ok: true, phase: 'flux', message: 'Flux source, config bundle, and all application HelmReleases reconciled.' };
}

export async function runAppChannelUpdate(rawInputs, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const releaseSelectionFile = options.releaseSelectionFile || DEFAULT_RELEASE_SELECTION_FILE;
  const updateHistoryFile = options.updateHistoryFile || DEFAULT_UPDATE_HISTORY_FILE;
  const owner = options.owner || {
    pid: process.pid,
    startedAt: options.startedAt || nowIso()
  };

  const previousSelection = readJsonFile(releaseSelectionFile);
  // An app-channel update rebuilds runtime values from the release's baked template
  // and re-applies the operator's app hostname (and DNS) from the persisted release
  // selection. If that selection can't be read, the rebuild would silently reset the
  // app URL (NEXTAUTH_URL) to the placeholder host and break sign-in. Refuse loudly
  // instead — unless the caller passed an explicit hostname to apply. (A selection
  // whose runtime.appHostname is an empty string is a deliberate default-host install
  // and is allowed through.)
  if (!rawInputs.appHostname && (!previousSelection || !previousSelection.runtime)) {
    const channel = String(rawInputs.channel || '').trim() || 'stable';
    const failure = {
      ok: false,
      phase: 'registry-release-source',
      step: 'read-release-selection',
      message: 'Cannot run app update: the saved release selection (release-selection.json) is missing or unreadable, so the configured app URL cannot be preserved. Re-run setup before updating.',
      suspectedCause: `Release selection not found or invalid at ${releaseSelectionFile}.`,
      suggestedNextStep: 'Re-run setup so the app hostname is persisted, then retry the update.',
      retrySafe: false
    };
    return finishUpdateFailure(failure, { stateFile, updateHistoryFile, channel, owner });
  }
  const selection = previousSelection || {};
  const validated = validateSetupInputs({
    channel: rawInputs.channel,
    appHostname: rawInputs.appHostname || selection.runtime?.appHostname || '',
    dnsMode: rawInputs.dnsMode || selection.runtime?.dnsMode || 'system',
    dnsServers: rawInputs.dnsServers || selection.runtime?.dnsServers || '',
    releaseRef: rawInputs.releaseRef || ''
  }, { requireInitialTenant: false });

  writeInstallState({
    status: 'update-running',
    phase: 'registry-release-source',
    lastAction: `Starting app-channel update to ${validated.channel}`,
    updatedAt: nowIso(),
    update: updateIntent(validated.channel, owner)
  }, stateFile);

  const workflowOptions = {
    ...options,
    stateFile,
    update: updateIntent(validated.channel, owner)
  };

  // Channel updates are also the delivery path for appliance control-plane
  // fixes. Reconcile the storage prerequisite first so an appliance affected by
  // the historical duplicate local-path controllers can recover before Helm is
  // asked to converge PostgreSQL, Redis, and the application deployment.
  const storageResult = installStorage(workflowOptions);
  if (!storageResult.ok) {
    return finishUpdateFailure(storageResult, {
      stateFile,
      updateHistoryFile,
      channel: validated.channel,
      owner
    });
  }

  const releaseSelection = await resolveChannelMetadata(validated, workflowOptions);
  if (!releaseSelection.ok) {
    return finishUpdateFailure(releaseSelection, {
      stateFile,
      updateHistoryFile,
      channel: validated.channel,
      owner
    });
  }

  // From here on the HelmReleases are suspended: values, the config bundle,
  // and the release selection all land while helm-controller is not looking,
  // so the resume below produces one upgrade per release instead of one per
  // changed input (the double-upgrade race, see helm-release-recovery.mjs).
  // Any failure after this point resumes the releases first — a silently
  // suspended appliance would never update again.
  const gate = await suspendAppReleases(options);
  if (!gate.ok) {
    return finishUpdateFailure(gate, { stateFile, updateHistoryFile, channel: validated.channel, owner });
  }
  const failWhileSuspended = async (failure) => {
    const resumed = await resumeAppReleases(options);
    if (!resumed.ok) {
      failure = { ...failure, suspectedCause: `${failure.suspectedCause || failure.message} (additionally: ${resumed.suspectedCause})`, suggestedNextStep: resumed.suggestedNextStep };
    }
    return finishUpdateFailure(failure, { stateFile, updateHistoryFile, channel: validated.channel, owner });
  };

  const runtimeValuesResult = await applyRuntimeValuesAndReleaseSelection(validated, releaseSelection, workflowOptions);
  if (!runtimeValuesResult.ok) {
    return failWhileSuspended(runtimeValuesResult);
  }

  const fluxSourceResult = applyFluxSource(validated, releaseSelection, workflowOptions);
  if (!fluxSourceResult.ok) {
    return failWhileSuspended(fluxSourceResult);
  }

  const configResult = applyReleaseSelectionConfiguration(validated, releaseSelection, {
    ...workflowOptions,
    releaseSelectionFile
  });
  if (!configResult.ok) {
    return failWhileSuspended(configResult);
  }

  const reconcileResult = await reconcileFluxAndHelm(options, {
    manifest: options.releaseManifestOverride ? runtimeValuesManifest(options) : releaseSelection.manifest,
    onProgress: (lastAction) => writeInstallState({
      status: 'update-running',
      phase: 'flux',
      lastAction,
      updatedAt: nowIso(),
      update: updateIntent(validated.channel, owner)
    }, stateFile)
  });
  if (!reconcileResult.ok) {
    // reconcileFluxAndHelm resumes the releases itself before the upgrade; a
    // failure before that point still needs them resumed here.
    return failWhileSuspended(reconcileResult);
  }

  const result = {
    ok: true,
    phase: 'registry-release-source',
    message: reconcileResult.pending
      ? `App-channel update applied for ${validated.channel}; services are still reconciling in the background (${reconcileResult.waiting.join(', ')}).`
      : `App-channel update applied for ${validated.channel}; OS and k3s updates remain manual in v1.`,
    releaseVersion: releaseSelection.releaseVersion,
    selectedChannel: validated.channel,
    updateScope: 'application-only'
  };

  writeInstallState({
    status: 'update-complete',
    phase: 'registry-release-source',
    lastAction: result.message,
    updatedAt: nowIso(),
    update: {
      ...updateIntent(validated.channel, null, owner.startedAt),
      selectedReleaseVersion: releaseSelection.releaseVersion
    }
  }, stateFile);

  appendUpdateHistory({
    at: nowIso(),
    channel: validated.channel,
    ok: true,
    releaseVersion: releaseSelection.releaseVersion,
    message: result.message
  }, updateHistoryFile);

  persistMaintenanceMetadata({
    metadataFile: options.metadataFile,
    releaseSelectionFile,
    installStateFile: stateFile,
    osReleaseFile: options.osReleaseFile,
    k3sVersionCommand: options.k3sVersionCommand
  });

  return result;
}

function parseCliArgs(argv) {
  const parsed = { command: argv[0] || '' };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--channel') {
      parsed.channel = argv[i + 1];
      i += 1;
    } else if (arg === '--state-file') {
      parsed.stateFile = argv[i + 1];
      i += 1;
    } else if (arg === '--release-selection-file') {
      parsed.releaseSelectionFile = argv[i + 1];
      i += 1;
    } else if (arg === '--update-history-file') {
      parsed.updateHistoryFile = argv[i + 1];
      i += 1;
    } else if (arg === '--started-at') {
      parsed.startedAt = argv[i + 1];
      i += 1;
    } else if (arg === '--kubeconfig') {
      parsed.kubeconfigPath = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

// CLI entry so server.mjs can run app-channel updates in a detached child
// (queueUpdateWorkflow), keeping the control plane's event loop — and its
// /healthz liveness probe — responsive while the engine's spawnSync steps run.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === 'run') {
    const channel = args.channel || 'stable';
    args.owner = {
      pid: process.pid,
      startedAt: args.startedAt || nowIso()
    };
    const writeInterruptedState = (signal) => {
      const failure = {
        ok: false,
        code: 'update_interrupted',
        category: 'update-interrupted',
        phase: 'update',
        step: 'handle-update-signal',
        message: `App-channel update was interrupted by ${signal}.`,
        suspectedCause: `The update child received ${signal}.`,
        suggestedNextStep: 'Retry the update from the Manage page; inspect control-plane logs if it recurs.',
        retrySafe: true
      };
      finishUpdateFailure(failure, {
        stateFile: args.stateFile || DEFAULT_STATE_FILE,
        updateHistoryFile: args.updateHistoryFile || DEFAULT_UPDATE_HISTORY_FILE,
        channel,
        owner: args.owner
      });
      process.exit(1);
    };
    const onSigterm = () => writeInterruptedState('SIGTERM');
    const onSigint = () => writeInterruptedState('SIGINT');
    process.once('SIGTERM', onSigterm);
    process.once('SIGINT', onSigint);
    try {
      const result = await runAppChannelUpdate({ channel }, args);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      // The Manage UI polls install-state until it reaches update-complete or
      // update-blocked; an unexpected crash must still land on a terminal
      // state instead of leaving update-running behind forever.
      const failure = {
        ok: false,
        phase: 'update',
        step: 'run-app-channel-update',
        message: 'App-channel update failed before it could complete.',
        suspectedCause: error instanceof Error ? error.message : String(error),
        suggestedNextStep: 'Retry the update from the Manage page; inspect control-plane logs if it recurs.',
        retrySafe: true
      };
      finishUpdateFailure(failure, {
        stateFile: args.stateFile || DEFAULT_STATE_FILE,
        updateHistoryFile: args.updateHistoryFile || DEFAULT_UPDATE_HISTORY_FILE,
        channel,
        owner: args.owner
      });
      process.stderr.write(`${JSON.stringify(failure)}\n`);
      process.exitCode = 1;
    } finally {
      process.off('SIGTERM', onSigterm);
      process.off('SIGINT', onSigint);
    }
  }
}
