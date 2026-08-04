#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { applyFluxSource, applyReleaseSelectionConfiguration, applyRuntimeValuesAndReleaseSelection, installStorage, resolveChannelMetadata, validateSetupInputs } from './setup-engine.mjs';
import { persistMaintenanceMetadata } from './metadata-engine.mjs';
import { appendUpdateHistory, readJsonFile, writeSecureJsonFileAtomic } from './update-state.mjs';

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

// Read the alga-core HelmRelease Ready condition so a non-zero `flux reconcile`
// exit can be judged against the release's *actual* state instead of the CLI's
// (often transient) result. Returns { readable, ready, hardFailed, reason,
// message }; readable=false means we could not determine the state.
// LEVERAGE: pattern appliance-transient-reconcile-vs-failure — status-engine
// already distinguishes transient Helm convergence from real failure
// (isTransientHelmReleaseConvergenceIssue); this is the same judgment applied to
// the update path. A shared classifier would unify them.
function readHelmReleaseReadiness(options = {}) {
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const name = options.helmReleaseName || 'alga-core';
  const namespace = options.helmReleaseNamespace || 'alga-system';
  const cmd = options.readHelmReleaseCommand
    || `kubectl --kubeconfig ${kubeconfigPath} -n ${namespace} get helmrelease ${name} -o json`;
  const res = spawnSync('sh', ['-c', cmd], { env: process.env, encoding: 'utf8' });
  if (res.status !== 0) return { readable: false };
  let condition = null;
  try {
    const hr = JSON.parse(res.stdout || '{}');
    condition = (hr?.status?.conditions || []).find((c) => c.type === 'Ready') || null;
  } catch {
    return { readable: false };
  }
  if (!condition) return { readable: false };
  const status = condition.status || 'Unknown';
  const reason = condition.reason || 'Unknown';
  return {
    readable: true,
    ready: status === 'True',
    // helm-controller terminal reasons; anything else is still converging.
    hardFailed: status === 'False' && /Failed|RetriesExceeded|Stalled|Exhausted/i.test(reason),
    reason,
    message: condition.message || ''
  };
}

function reconcileFluxAndHelm(options = {}) {
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const fluxSourceName = options.fluxSourceName || 'alga-appliance';
  const reconcileTimeout = options.reconcileTimeout || '15m';

  const reconcileSourceCmd = options.reconcileSourceCommand
    || `flux --kubeconfig ${kubeconfigPath} reconcile source oci ${fluxSourceName} -n flux-system --timeout ${reconcileTimeout}`;
  const reconcileHelmCmd = options.reconcileHelmCommand
    || `flux --kubeconfig ${kubeconfigPath} reconcile helmrelease alga-core -n alga-system --with-source --timeout ${reconcileTimeout}`;

  const source = spawnSync('sh', ['-c', reconcileSourceCmd], { env: process.env, encoding: 'utf8' });
  if (source.status !== 0) {
    return {
      ok: false,
      phase: 'flux',
      message: 'Flux source reconcile failed during app update.',
      suspectedCause: (source.stderr || source.stdout || '').trim() || `exit ${source.status ?? 1}`,
      suggestedNextStep: 'Verify Flux source-controller health and OCIRepository readiness.',
      retrySafe: true
    };
  }

  const helm = spawnSync('sh', ['-c', reconcileHelmCmd], { env: process.env, encoding: 'utf8' });
  if (helm.status !== 0) {
    const cliCause = (helm.stderr || helm.stdout || '').trim() || `exit ${helm.status ?? 1}`;
    // `flux reconcile helmrelease --with-source` kicks a reconcile and waits for
    // the Ready condition; a non-zero exit is frequently transient — the
    // controller is already reconciling, or the wait times out while the roll
    // continues. The runtime values + release-selection are already written, so
    // Flux keeps converging regardless. Judge the outcome from the HelmRelease's
    // actual Ready condition rather than the CLI exit code; only a genuinely
    // failed release (or one we cannot read at all) is reported as a block.
    const readiness = readHelmReleaseReadiness(options);
    if (readiness.readable && readiness.ready) {
      return { ok: true, phase: 'flux', message: 'Flux source and HelmRelease reconcile completed.' };
    }
    if (readiness.readable && !readiness.hardFailed) {
      return {
        ok: true,
        phase: 'flux',
        pending: true,
        message: 'Update applied; services are still reconciling in the background.'
      };
    }
    return {
      ok: false,
      phase: 'flux',
      message: 'HelmRelease reconcile failed during app update.',
      suspectedCause: readiness.message || cliCause,
      suggestedNextStep: 'Inspect alga-core HelmRelease events and controller logs.',
      retrySafe: true
    };
  }

  return { ok: true, phase: 'flux', message: 'Flux source and HelmRelease reconcile completed.' };
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

  const runtimeValuesResult = await applyRuntimeValuesAndReleaseSelection(validated, releaseSelection, workflowOptions);
  if (!runtimeValuesResult.ok) {
    return finishUpdateFailure(runtimeValuesResult, {
      stateFile,
      updateHistoryFile,
      channel: validated.channel,
      owner
    });
  }

  const fluxSourceResult = applyFluxSource(validated, releaseSelection, workflowOptions);
  if (!fluxSourceResult.ok) {
    return finishUpdateFailure(fluxSourceResult, {
      stateFile,
      updateHistoryFile,
      channel: validated.channel,
      owner
    });
  }

  const configResult = applyReleaseSelectionConfiguration(validated, releaseSelection, {
    ...workflowOptions,
    releaseSelectionFile
  });
  if (!configResult.ok) {
    return finishUpdateFailure(configResult, {
      stateFile,
      updateHistoryFile,
      channel: validated.channel,
      owner
    });
  }

  const reconcileResult = reconcileFluxAndHelm(options);
  if (!reconcileResult.ok) {
    return finishUpdateFailure(reconcileResult, {
      stateFile,
      updateHistoryFile,
      channel: validated.channel,
      owner
    });
  }

  const result = {
    ok: true,
    phase: 'registry-release-source',
    message: reconcileResult.pending
      ? `App-channel update applied for ${validated.channel}; services are reconciling in the background.`
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
