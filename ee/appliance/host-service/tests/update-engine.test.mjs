import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runAppChannelUpdate } from '../update-engine.mjs';
import { applyReleaseSelectionConfiguration, installStorage } from '../setup-engine.mjs';

const enginePath = path.join(import.meta.dirname, '..', 'update-engine.mjs');
const serverPath = path.join(import.meta.dirname, '..', 'server.mjs');

const CHART_VERSION = '0.0.0-appliance.5411aa63';
const RELEASES = ['alga-core', 'pgbouncer', 'temporal', 'temporal-worker', 'workflow-worker', 'email-service'];

// A scriptable kubectl for the update engine:
//  - `get helmrelease NAME -o json` prints $tmp/hr/NAME.json (not found otherwise)
//  - `get job NAME -o json` prints $tmp/job/NAME.json (not found otherwise)
//  - `delete job NAME` removes that file
//  - `annotate helmrelease alga-core ... resetAt=...` swaps in
//    $tmp/hr/alga-core.after-reset.json when present (simulates the forced
//    upgrade succeeding after the hook Job was cleared)
//  - everything else swallows stdin and exits 0
// Every invocation is appended to $tmp/kubectl.log so tests can assert order.
function writeFakeKubectl(tmp) {
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'hr'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'job'), { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'kubectl'), `#!/usr/bin/env bash
TMP=${JSON.stringify(tmp)}
printf '%s\\n' "$*" >> "$TMP/kubectl.log"
args=("$@")
kind=""; name=""; verb=""
for ((i=0; i<\${#args[@]}; i++)); do
  case "\${args[$i]}" in
    get|delete|patch|annotate|apply|create) verb="\${args[$i]}"; kind="\${args[$((i+1))]}"; name="\${args[$((i+2))]}";;
  esac
done
case "$verb $kind" in
  "get kustomizations.kustomize.toolkit.fluxcd.io")
    [ -f "$TMP/kustomizations.txt" ] && cat "$TMP/kustomizations.txt"; exit 0;;
  "get helmrelease")
    if [ -f "$TMP/hr/$name.json" ]; then cat "$TMP/hr/$name.json"; exit 0; fi
    echo "Error from server (NotFound): helmreleases.helm.toolkit.fluxcd.io \\"$name\\" not found" >&2; exit 1;;
  "get job")
    if [ -f "$TMP/job/$name.json" ]; then cat "$TMP/job/$name.json"; exit 0; fi
    echo "Error from server (NotFound): jobs.batch \\"$name\\" not found" >&2; exit 1;;
  "delete job")
    rm -f "$TMP/job/$name.json"; exit 0;;
  "annotate helmrelease")
    if [[ "$*" == *resetAt=* ]] && [ -f "$TMP/hr/$name.after-reset.json" ]; then mv "$TMP/hr/$name.after-reset.json" "$TMP/hr/$name.json"; fi
    exit 0;;
esac
cat >/dev/null || true
exit 0
`);
  fs.chmodSync(path.join(fakeBin, 'kubectl'), 0o755);
  return fakeBin;
}

function helmReleaseJson({ ready = 'True', reason = 'ReconciliationSucceeded', message = '', chartVersion = CHART_VERSION, attempted = chartVersion, generation = 3, observedGeneration = 3, stalled = false, suspend } = {}) {
  const conditions = [{ type: 'Ready', status: ready, reason, message }];
  if (stalled) conditions.push({ type: 'Stalled', status: 'True', reason: 'RetriesExceeded', message });
  return JSON.stringify({
    metadata: { generation },
    spec: { chart: { spec: { chart: 'x', version: chartVersion } }, ...(suspend === undefined ? {} : { suspend }) },
    status: { observedGeneration, lastAttemptedRevision: attempted, conditions }
  });
}

function writeHelmReleases(tmp, overrides = {}) {
  for (const name of RELEASES) {
    fs.writeFileSync(path.join(tmp, 'hr', `${name}.json`), helmReleaseJson(overrides[name] || {}));
  }
}

function kubectlLog(tmp) {
  const file = path.join(tmp, 'kubectl.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
}

function indexOfLog(lines, pattern) {
  return lines.findIndex((line) => pattern.test(line));
}

// Build the common runAppChannelUpdate fixture. The manifest pins every chart
// at CHART_VERSION and the fake HelmReleases are Ready at that version, so the
// happy path converges immediately; tests override pieces to vary the outcome.
function makeUpdateFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-update-engine-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  const updateHistoryFile = path.join(tmp, 'update-history.json');
  const metadataFile = path.join(tmp, 'maintenance-metadata.json');
  const fluxManifestPath = path.join(tmp, 'flux-source.yaml');
  const fakeBin = writeFakeKubectl(tmp);
  writeHelmReleases(tmp);
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    registryHost: 'ghcr.io',
    repository: 'nine-minds/alga-appliance-release',
    manifestDigest: 'sha256:previous',
    runtime: { appHostname: 'psa.example.com', dnsMode: 'system', dnsServers: '' }
  }));
  const valueYaml = `image:\n  tag: latest\n`;
  const temporalWorkerYaml = `applicationUrl: http://alga-core.msp.svc.cluster.local:3000\npublicBaseUrl: https://alga.local\nimage:\n  tag: latest\n`;
  const coreYaml = `appUrl: https://alga.local\nhost: alga.local\ndomainSuffix: alga.local\nbootstrap:\n  mode: recover\nsetup:\n  image:\n    tag: latest\nserver:\n  image:\n    tag: latest\n`;
  const options = {
    stateFile,
    releaseSelectionFile,
    updateHistoryFile,
    releaseManifestOverride: {
      schema: 'alga.appliance.release/v1',
      version: '2.0.0-nightly.1',
      valuesProfile: 'test-profile',
      images: { algaCore: 'core1234', workflowWorker: 'worker1234', emailService: 'email1234', temporalWorker: 'temporal1234' },
      controlPlane: 'cp1234',
      config: { repository: 'ghcr.io/nine-minds/alga-appliance-config', tag: '2.0.0-nightly.1', digest: 'sha256:feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface' },
      charts: { sebastian: CHART_VERSION, 'email-service': CHART_VERSION, pgbouncer: CHART_VERSION, temporal: CHART_VERSION, 'temporal-worker': CHART_VERSION, 'workflow-worker': CHART_VERSION },
      profileValues: {
        'alga-core.test-profile.yaml': coreYaml,
        'pgbouncer.test-profile.yaml': valueYaml,
        'temporal.test-profile.yaml': valueYaml,
        'workflow-worker.test-profile.yaml': valueYaml,
        'email-service.test-profile.yaml': valueYaml,
        'temporal-worker.test-profile.yaml': temporalWorkerYaml
      }
    },
    tokenFile: path.join(tmp, 'setup-token'),
    storageInstallCommand: 'true',
    fluxSourceApplyCommand: `cat > ${fluxManifestPath}`,
    reconcileSourceCommand: `echo source >> ${path.join(tmp, 'flux.log')}`,
    reconcileKustomizationCommand: `echo kustomization >> ${path.join(tmp, 'flux.log')}; echo kustomization >> ${path.join(tmp, 'kubectl.log')}`,
    reconcileHelmCommand: `echo helmrelease >> ${path.join(tmp, 'flux.log')}; echo helmrelease >> ${path.join(tmp, 'kubectl.log')}`,
    sleep: async () => {},
    convergeTimeoutMs: 0,
    chartPinTimeoutMs: 0,
    hookJobWaitMs: 0,
    metadataFile,
    osReleaseFile: path.join(tmp, 'os-release'),
    k3sVersionCommand: "printf 'k3s version v1.31.4+k3s1'"
  };
  return { tmp, stateFile, releaseSelectionFile, updateHistoryFile, fluxManifestPath, fakeBin, options };
}

async function runUpdate(fixture, overrides = {}) {
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixture.fakeBin}:${originalPath}`;
  try {
    const result = await runAppChannelUpdate({ channel: 'nightly' }, { ...fixture.options, ...overrides });
    const state = JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8'));
    return { result, state, log: kubectlLog(fixture.tmp) };
  } finally {
    process.env.PATH = originalPath;
  }
}

test('runAppChannelUpdate applies channel update and persists history without OS/k3s mutation scope', async () => {
  const fixture = makeUpdateFixture();
  const { result, state } = await runUpdate(fixture);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.selectedChannel, 'nightly');
  assert.equal(result.updateScope, 'application-only');
  assert.equal(state.status, 'update-complete');
  assert.equal(state.update.scope, 'application-only');
  assert.equal(state.update.owner, undefined);

  const releaseSelection = JSON.parse(fs.readFileSync(fixture.releaseSelectionFile, 'utf8'));
  assert.equal(releaseSelection.selectedChannel, 'nightly');
  assert.equal(releaseSelection.selectedReleaseVersion, '2.0.0-nightly.1');

  const history = JSON.parse(fs.readFileSync(fixture.updateHistoryFile, 'utf8'));
  assert.equal(Array.isArray(history.history), true);
  assert.equal(history.history[0].ok, true);

  assert.match(fs.readFileSync(fixture.fluxManifestPath, 'utf8'), /kind: OCIRepository/);
});

// The 2026-09-18 race: values ConfigMaps and the chart pin used to reach the
// HelmRelease in two separate reconciles, so helm-controller ran two upgrades
// back to back and the second collided with the first one's hook Job. The
// engine now suspends every appliance HelmRelease before touching any input
// and resumes only once the config bundle (chart pins) has been applied.
test('app update suspends all HelmReleases before values are applied and resumes only after the chart pins landed', async () => {
  const fixture = makeUpdateFixture();
  const { result, log } = await runUpdate(fixture);
  assert.equal(result.ok, true, JSON.stringify(result));

  // kustomize-controller strips fields owned by kubectl's default managers on
  // its next apply, so the suspend must be written as the Flux CLI's manager.
  const suspendLines = log.filter((l) => /patch helmrelease .* --field-manager=flux-client-side-apply --type merge -p \{"spec":\{"suspend":true\}\}/.test(l));
  const resumeLines = log.filter((l) => /patch helmrelease .* --field-manager=flux-client-side-apply --type merge -p \{"spec":\{"suspend":null\}\}/.test(l));
  assert.deepEqual(suspendLines.map((l) => l.match(/patch helmrelease (\S+)/)[1]).sort(), [...RELEASES].sort());
  assert.deepEqual(resumeLines.map((l) => l.match(/patch helmrelease (\S+)/)[1]).sort(), [...RELEASES].sort());

  const lastSuspend = log.length - 1 - [...log].reverse().findIndex((l) => /"suspend":true/.test(l));
  const valuesApply = indexOfLog(log, /apply -k /);
  const kustomization = indexOfLog(log, /^kustomization$/);
  const firstResume = indexOfLog(log, /"suspend":null/);
  const lastResume = log.length - 1 - [...log].reverse().findIndex((l) => /"suspend":null/.test(l));
  const helmReconcile = indexOfLog(log, /^helmrelease$/);
  assert.ok(lastSuspend < valuesApply, 'all suspends precede the values apply');
  assert.ok(valuesApply < kustomization, 'values are applied before the Kustomization reconcile');
  assert.ok(kustomization < firstResume, 'no resume before the chart pins are applied');
  assert.ok(lastResume < helmReconcile, 'the alga-core reconcile runs after every release is resumed');
});

// The bundle is layered (alga-appliance -> alga-core / alga-background
// Kustomizations -> HelmReleases), so the chart pins land a little after the
// top-level reconcile. The engine nudges the nested Kustomizations and polls.
test('app update nudges the nested Kustomizations and waits for the chart pins before resuming', async () => {
  const fixture = makeUpdateFixture();
  fs.writeFileSync(path.join(fixture.tmp, 'kustomizations.txt'), 'flux-system/alga-platform\nflux-system/alga-core\nflux-system/alga-background\n');
  writeHelmReleases(fixture.tmp, { temporal: { chartVersion: '0.0.0-appliance.bf9f1327' }, 'alga-core': { chartVersion: '0.0.0-appliance.bf9f1327' } });
  let polls = 0;
  const { result, log } = await runUpdate(fixture, {
    chartPinTimeoutMs: 60_000,
    sleep: async () => {
      polls += 1;
      if (polls === 2) writeHelmReleases(fixture.tmp); // nested Kustomizations catch up
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(polls >= 2);
  const nudges = log.filter((l) => /annotate kustomizations\.kustomize\.toolkit\.fluxcd\.io .* reconcile\.fluxcd\.io\/requestedAt=/.test(l));
  assert.deepEqual(nudges.map((l) => l.match(/kustomizations\.kustomize\.toolkit\.fluxcd\.io (\S+)/)[1]), ['alga-platform', 'alga-core', 'alga-background']);
  const kustomization = indexOfLog(log, /^kustomization$/);
  const firstNudge = indexOfLog(log, /annotate kustomizations/);
  const firstResume = indexOfLog(log, /"suspend":null/);
  assert.ok(kustomization < firstNudge && firstNudge < firstResume);
});

test('app update refuses to resume when the config bundle did not update the chart pins', async () => {
  const fixture = makeUpdateFixture();
  writeHelmReleases(fixture.tmp, { temporal: { chartVersion: '0.0.0-appliance.bf9f1327', attempted: '0.0.0-appliance.bf9f1327' } });
  const { result, state, log } = await runUpdate(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.step, 'verify-chart-pins');
  assert.match(result.suspectedCause, /temporal: chart version is 0\.0\.0-appliance\.bf9f1327/);
  assert.equal(state.status, 'update-blocked');
  // Never leaves the appliance silently suspended.
  assert.equal(log.filter((l) => /"suspend":null/.test(l)).length, RELEASES.length);
  assert.equal(indexOfLog(log, /^helmrelease$/), -1, 'the upgrade was not started');
});

test('app update resumes the HelmReleases when a step fails while they are suspended', async () => {
  const fixture = makeUpdateFixture();
  const { result, state, log } = await runUpdate(fixture, {
    fluxSourceApplyCommand: "printf 'apply refused' >&2; exit 1"
  });
  assert.equal(result.ok, false);
  assert.equal(state.status, 'update-blocked');
  const lastSuspend = log.length - 1 - [...log].reverse().findIndex((l) => /"suspend":true/.test(l));
  const firstResume = indexOfLog(log, /"suspend":null/);
  assert.ok(firstResume > lastSuspend);
  assert.equal(log.filter((l) => /"suspend":null/.test(l)).length, RELEASES.length);
});

test('app update waits for a still-running bootstrap hook Job and deletes it before resuming', async () => {
  const fixture = makeUpdateFixture();
  const jobFile = path.join(fixture.tmp, 'job', 'alga-core-sebastian-bootstrap.json');
  fs.writeFileSync(jobFile, JSON.stringify({ status: { active: 1 } }));
  let polls = 0;
  const { result, log } = await runUpdate(fixture, {
    hookJobWaitMs: 60_000,
    sleep: async () => {
      polls += 1;
      // The Job finishes on the second poll.
      if (polls === 2) fs.writeFileSync(jobFile, JSON.stringify({ status: { active: 0, succeeded: 1 } }));
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(polls >= 2);
  const del = indexOfLog(log, /delete job alga-core-sebastian-bootstrap --ignore-not-found=true --wait=true/);
  const firstResume = indexOfLog(log, /"suspend":null/);
  assert.ok(del >= 0 && del < firstResume, 'the Job is deleted (and gone) before any release resumes');
  assert.equal(fs.existsSync(jobFile), false);
});

test('app update: helm reconcile exits non-zero but every HelmRelease converges -> complete, not blocked', async () => {
  const fixture = makeUpdateFixture();
  const { result, state } = await runUpdate(fixture, { reconcileHelmCommand: 'false' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.status, 'update-complete');
  assert.doesNotMatch(result.message, /background/);
});

test('app update: alga-core Ready but a dependent still progressing -> applied/pending, not blocked', async () => {
  const fixture = makeUpdateFixture();
  writeHelmReleases(fixture.tmp, { 'workflow-worker': { ready: 'False', reason: 'Progressing', message: 'dependency not ready' } });
  const { result, state } = await runUpdate(fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.status, 'update-complete');
  assert.match(result.message, /reconciling in the background \(workflow-worker \(Progressing\)\)/);
});

test('app update: a stale Ready=True from the previous generation or chart version is not convergence', async () => {
  const fixture = makeUpdateFixture();
  writeHelmReleases(fixture.tmp, {
    'alga-core': { generation: 4, observedGeneration: 3 },
    temporal: { attempted: '0.0.0-appliance.bf9f1327' }
  });
  const { result } = await runUpdate(fixture);
  assert.equal(result.ok, true);
  assert.match(result.message, /alga-core \(ReconciliationSucceeded\)/);
  assert.match(result.message, /temporal \(ReconciliationSucceeded\)/);
});

test('app update: HelmRelease genuinely failed -> blocked', async () => {
  const fixture = makeUpdateFixture();
  writeHelmReleases(fixture.tmp, { 'alga-core': { ready: 'False', reason: 'UpgradeFailed', message: 'image pull back-off', stalled: true } });
  const { result, state } = await runUpdate(fixture, { reconcileHelmCommand: 'false' });
  assert.equal(result.ok, false);
  assert.equal(result.helmRelease, 'alga-core');
  assert.match(result.suspectedCause, /image pull back-off/);
  assert.equal(state.status, 'update-blocked');
});

test('app update: a dependent HelmRelease failing also blocks (the workers must move too)', async () => {
  const fixture = makeUpdateFixture();
  writeHelmReleases(fixture.tmp, { 'email-service': { ready: 'False', reason: 'UpgradeFailed', message: 'chart pull failed' } });
  const { result, state } = await runUpdate(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.helmRelease, 'email-service');
  assert.equal(state.status, 'update-blocked');
});

test('app update: HelmRelease unreadable -> blocked (conservative)', async () => {
  const fixture = makeUpdateFixture();
  fs.rmSync(path.join(fixture.tmp, 'hr', 'alga-core.json'));
  const { result, state } = await runUpdate(fixture);
  assert.equal(result.ok, false);
  assert.equal(state.status, 'update-blocked');
});

// Belt and braces for the hook-Job collision: if it still happens (e.g. an
// operator-triggered upgrade racing the update), the engine clears the Job and
// forces a reset reconcile once instead of leaving the release Stalled.
test('app update recovers once from the bootstrap hook Job collision by clearing the Job and resetting the release', async () => {
  const fixture = makeUpdateFixture();
  const collision = 'server-side apply failed for object msp/alga-core-sebastian-bootstrap batch/v1, Kind=Job: Job.batch "alga-core-sebastian-bootstrap" is invalid: spec.template: Invalid value: ...: field is immutable';
  writeHelmReleases(fixture.tmp, { 'alga-core': { ready: 'False', reason: 'UpgradeFailed', message: collision, stalled: true } });
  fs.writeFileSync(path.join(fixture.tmp, 'hr', 'alga-core.after-reset.json'), helmReleaseJson());
  fs.writeFileSync(path.join(fixture.tmp, 'job', 'alga-core-sebastian-bootstrap.json'), JSON.stringify({ status: { succeeded: 1 } }));
  const { result, state, log } = await runUpdate(fixture, { convergeTimeoutMs: 60_000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.status, 'update-complete');
  const del = [...log].reverse().findIndex((l) => /delete job alga-core-sebastian-bootstrap/.test(l));
  assert.ok(del >= 0);
  const reset = log.find((l) => /annotate helmrelease alga-core .*reconcile\.fluxcd\.io\/resetAt=/.test(l));
  assert.ok(reset, 'the retry uses resetAt (flux --reset) so a Stalled release is allowed to try again');
  assert.match(reset, /reconcile\.fluxcd\.io\/forceAt=/);
  assert.match(reset, /reconcile\.fluxcd\.io\/requestedAt=/);
});

test('app update does not retry a second hook Job collision', async () => {
  const fixture = makeUpdateFixture();
  const collision = 'msp/alga-core-sebastian-bootstrap batch/v1, Kind=Job ... field is immutable';
  writeHelmReleases(fixture.tmp, { 'alga-core': { ready: 'False', reason: 'UpgradeFailed', message: collision } });
  const { result, log } = await runUpdate(fixture, { convergeTimeoutMs: 60_000 });
  assert.equal(result.ok, false);
  assert.equal(log.filter((l) => /resetAt=/.test(l)).length, 1);
});

test('app update reports convergence progress in install-state while waiting', async () => {
  const fixture = makeUpdateFixture();
  writeHelmReleases(fixture.tmp, { temporal: { ready: 'False', reason: 'Progressing' } });
  const seen = [];
  const { result, state } = await runUpdate(fixture, {
    convergeTimeoutMs: 60_000,
    sleep: async () => {
      seen.push(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')));
      // temporal converges after the first poll.
      writeHelmReleases(fixture.tmp);
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(state.status, 'update-complete');
  assert.ok(seen.some((s) => s.status === 'update-running' && /Waiting for services to converge: temporal \(Progressing\)/.test(s.lastAction)), JSON.stringify(seen));
});

// The update must run in a separate process: the engine's spawnSync steps
// (storage reconcile, flux reconcile) block the event loop of whichever
// process runs them, and inside the control-plane server that freezes /healthz
// long enough for the pod's liveness probe to kill the container mid-update
// (alga0002202). server.mjs therefore spawns this CLI detached instead of
// calling runAppChannelUpdate in-process.
test('server runs app-channel updates in a detached child, never in-process', () => {
  const server = fs.readFileSync(serverPath, 'utf8');
  assert.doesNotMatch(server, /runAppChannelUpdate/);
  assert.match(server, /function queueUpdateWorkflow/);
  assert.match(server, /update-engine\.mjs/);
  assert.match(server, /spawnUpdate: queueUpdateWorkflow/);
});

test('update owner survives storage and release-configuration phases', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-update-owner-phases-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  const update = {
    requestedChannel: 'stable',
    scope: 'application-only',
    owner: { pid: 321, startedAt: '2026-08-03T20:00:00.000Z' }
  };

  const storage = installStorage({ stateFile, storageInstallCommand: 'true', update });
  assert.equal(storage.ok, true);
  let state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'update-running');
  assert.deepEqual(state.update.owner, update.owner);

  const config = applyReleaseSelectionConfiguration({
    channel: 'stable',
    appHostname: 'psa.example.com',
    dnsMode: 'system',
    dnsServers: ''
  }, {
    channel: 'stable',
    releaseVersion: '1.3.12',
    repository: 'nine-minds/alga-appliance-release',
    manifestDigest: 'sha256:abc'
  }, { stateFile, releaseSelectionFile, update });
  assert.equal(config.ok, true);
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'update-running');
  assert.deepEqual(state.update.owner, update.owner);
});

test('update-engine CLI reports a blocked terminal state when the update fails cleanly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-update-cli-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const historyFile = path.join(tmp, 'update-history.json');

  // No release-selection.json: the engine refuses the update before touching
  // storage, the registry, or the cluster — deterministic and offline.
  const result = spawnSync(process.execPath, [
    enginePath,
    'run',
    '--channel', 'stable',
    '--state-file', stateFile,
    '--release-selection-file', path.join(tmp, 'release-selection.json'),
    '--update-history-file', historyFile
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'update-blocked');
  const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  assert.equal(history.history[0].ok, false);
});

test('update-engine CLI writes a blocked terminal state even when the engine throws', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-update-cli-throw-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const historyFile = path.join(tmp, 'update-history.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({
    runtime: { appHostname: 'psa.example.com', dnsMode: 'system', dnsServers: '' }
  }));

  // An invalid channel makes validateSetupInputs throw; the Manage UI polls
  // install-state until a terminal status, so the crash must still land on
  // update-blocked instead of leaving the state mid-flight forever.
  const result = spawnSync(process.execPath, [
    enginePath,
    'run',
    '--channel', 'bogus',
    '--state-file', stateFile,
    '--release-selection-file', releaseSelectionFile,
    '--update-history-file', historyFile
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.status, 'update-blocked');
  assert.match(state.failure.suspectedCause, /Invalid channel/);
  assert.equal(state.failure.retrySafe, true);
  assert.equal(state.update.owner, undefined);
});

test('app update stops before release reconciliation when storage repair fails', async () => {
  const { stateFile, fakeBin, options } = makeUpdateFixture();
  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  try {
    const result = await runAppChannelUpdate({ channel: 'nightly' }, {
      ...options,
      storageInstallCommand: "printf 'storage unavailable' >&2; exit 1"
    });
    assert.equal(result.ok, false);
    assert.equal(result.phase, 'storage');
    assert.equal(result.step, 'install-local-path-storage');

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.status, 'update-blocked');
    assert.equal(state.phase, 'storage');
    assert.equal(state.failure.suspectedCause, 'Local-path storage reconciliation failed.');
    assert.equal(state.failure.suggestedNextStep, 'storage unavailable');
    assert.equal(state.update.owner, undefined);
  } finally {
    process.env.PATH = originalPath;
  }
});
