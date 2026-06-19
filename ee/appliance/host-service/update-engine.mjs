#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyFluxSource, applyReleaseSelectionConfiguration, applyRuntimeValuesAndReleaseSelection, resolveChannelMetadata, validateSetupInputs } from './setup-engine.mjs';
import { persistMaintenanceMetadata } from './metadata-engine.mjs';

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

function writeInstallState(state, stateFile) {
  writeSecureJsonFile(stateFile, state);
}

function appendUpdateHistory(entry, historyFile) {
  const existing = readJsonFile(historyFile);
  const history = Array.isArray(existing?.history) ? existing.history : [];
  const payload = {
    updatedAt: nowIso(),
    history: [entry, ...history].slice(0, 50)
  };
  writeSecureJsonFile(historyFile, payload);
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
    return {
      ok: false,
      phase: 'flux',
      message: 'HelmRelease reconcile failed during app update.',
      suspectedCause: (helm.stderr || helm.stdout || '').trim() || `exit ${helm.status ?? 1}`,
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
    writeInstallState({
      status: 'update-blocked',
      phase: failure.phase,
      lastAction: failure.message,
      failure,
      updatedAt: nowIso(),
      update: { requestedChannel: channel, scope: 'application-only' }
    }, stateFile);
    appendUpdateHistory({ at: nowIso(), channel, ok: false, phase: failure.phase, message: failure.message }, updateHistoryFile);
    return failure;
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
    update: {
      requestedChannel: validated.channel,
      scope: 'application-only'
    }
  }, stateFile);

  const releaseSelection = await resolveChannelMetadata(validated, options);
  if (!releaseSelection.ok) {
    appendUpdateHistory({
      at: nowIso(),
      channel: validated.channel,
      ok: false,
      phase: releaseSelection.phase,
      message: releaseSelection.message
    }, updateHistoryFile);
    return releaseSelection;
  }

  const runtimeValuesResult = await applyRuntimeValuesAndReleaseSelection(validated, releaseSelection, options);
  if (!runtimeValuesResult.ok) {
    appendUpdateHistory({
      at: nowIso(),
      channel: validated.channel,
      ok: false,
      phase: runtimeValuesResult.phase,
      message: runtimeValuesResult.message
    }, updateHistoryFile);
    return runtimeValuesResult;
  }

  const fluxSourceResult = applyFluxSource(validated, releaseSelection, options);
  if (!fluxSourceResult.ok) {
    appendUpdateHistory({
      at: nowIso(),
      channel: validated.channel,
      ok: false,
      phase: fluxSourceResult.phase,
      message: fluxSourceResult.message
    }, updateHistoryFile);
    return fluxSourceResult;
  }

  const configResult = applyReleaseSelectionConfiguration(validated, releaseSelection, {
    ...options,
    releaseSelectionFile
  });
  if (!configResult.ok) {
    appendUpdateHistory({
      at: nowIso(),
      channel: validated.channel,
      ok: false,
      phase: configResult.phase,
      message: configResult.message
    }, updateHistoryFile);
    return configResult;
  }

  const reconcileResult = reconcileFluxAndHelm(options);
  if (!reconcileResult.ok) {
    writeInstallState({
      status: 'update-blocked',
      phase: reconcileResult.phase,
      lastAction: reconcileResult.message,
      failure: reconcileResult,
      updatedAt: nowIso(),
      update: {
        requestedChannel: validated.channel,
        scope: 'application-only'
      }
    }, stateFile);
    appendUpdateHistory({
      at: nowIso(),
      channel: validated.channel,
      ok: false,
      phase: reconcileResult.phase,
      message: reconcileResult.message
    }, updateHistoryFile);
    return reconcileResult;
  }

  const result = {
    ok: true,
    phase: 'registry-release-source',
    message: `App-channel update applied for ${validated.channel}; OS and k3s updates remain manual in v1.`,
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
      requestedChannel: validated.channel,
      selectedReleaseVersion: releaseSelection.releaseVersion,
      scope: 'application-only'
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
