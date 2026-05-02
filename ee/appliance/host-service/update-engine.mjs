#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyFluxSource, applyReleaseSelectionConfiguration, resolveChannelMetadata, validateSetupInputs } from './setup-engine.mjs';
import { persistMaintenanceMetadata } from './metadata-engine.mjs';

const DEFAULT_STATE_FILE = '/var/lib/alga-appliance/install-state.json';
const DEFAULT_RELEASE_SELECTION_FILE = '/etc/alga-appliance/release-selection.json';
const DEFAULT_UPDATE_HISTORY_FILE = '/var/lib/alga-appliance/update-history.json';
const DEFAULT_KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';

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
    || `flux --kubeconfig ${kubeconfigPath} reconcile source git ${fluxSourceName} -n flux-system --timeout ${reconcileTimeout}`;
  const reconcileHelmCmd = options.reconcileHelmCommand
    || `flux --kubeconfig ${kubeconfigPath} reconcile helmrelease alga-core -n alga-system --with-source --timeout ${reconcileTimeout}`;

  const source = spawnSync('sh', ['-c', reconcileSourceCmd], { env: process.env, encoding: 'utf8' });
  if (source.status !== 0) {
    return {
      ok: false,
      phase: 'flux',
      message: 'Flux source reconcile failed during app update.',
      suspectedCause: (source.stderr || source.stdout || '').trim() || `exit ${source.status ?? 1}`,
      suggestedNextStep: 'Verify Flux source-controller health and GitRepository readiness.',
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

  const previousSelection = readJsonFile(releaseSelectionFile) || {};
  const validated = validateSetupInputs({
    channel: rawInputs.channel,
    appHostname: rawInputs.appHostname || previousSelection.runtime?.appHostname || '',
    dnsMode: rawInputs.dnsMode || previousSelection.runtime?.dnsMode || 'system',
    dnsServers: rawInputs.dnsServers || previousSelection.runtime?.dnsServers || '',
    repoUrl: rawInputs.repoUrl || previousSelection.repoUrl || 'https://github.com/Nine-Minds/alga-psa.git',
    repoBranch: rawInputs.repoBranch || previousSelection.repoBranch || 'main'
  });

  writeInstallState({
    status: 'update-running',
    phase: 'github-release-source',
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
    phase: 'github-release-source',
    message: `App-channel update applied for ${validated.channel}; OS and k3s updates remain manual in v1.`,
    releaseVersion: releaseSelection.releaseVersion,
    selectedChannel: validated.channel,
    updateScope: 'application-only'
  };

  writeInstallState({
    status: 'update-complete',
    phase: 'github-release-source',
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
