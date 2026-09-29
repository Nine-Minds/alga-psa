import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLIANCE_HELM_RELEASES,
  clearBootstrapJob,
  expectedChartVersions,
  isBootstrapJobCollision,
  nudgeChildKustomizations,
  recoverAppRelease,
  setHelmReleasesSuspended,
  summarizeHelmRelease
} from '../helm-release-recovery.mjs';

const serverPath = path.join(import.meta.dirname, '..', 'server.mjs');

// A kubectl stub: `responses` maps a regex source to a handler returning
// { ok, stdout, stderr }; unmatched invocations succeed with no output.
function stubKubectl(responses = []) {
  const calls = [];
  const runKubectl = async (args) => {
    calls.push(args);
    for (const [pattern, handler] of responses) {
      if (new RegExp(pattern).test(args)) return handler(args);
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  return { calls, runKubectl };
}

const notFound = (what) => () => ({ ok: false, stdout: '', stderr: `Error from server (NotFound): ${what} not found` });
const json = (value) => () => ({ ok: true, stdout: JSON.stringify(value), stderr: '' });

test('isBootstrapJobCollision only matches the immutable bootstrap Job signature', () => {
  assert.equal(isBootstrapJobCollision('server-side apply failed for object msp/alga-core-sebastian-bootstrap batch/v1, Kind=Job ... spec.template ... field is immutable'), true);
  assert.equal(isBootstrapJobCollision('Job.batch "alga-core-sebastian-bootstrap" is invalid: field is immutable'), true);
  assert.equal(isBootstrapJobCollision('field is immutable'), false);
  assert.equal(isBootstrapJobCollision('alga-core-sebastian-bootstrap failed: BackoffLimitExceeded'), false);
  assert.equal(isBootstrapJobCollision(''), false);
});

test('summarizeHelmRelease reads readiness, staleness, stall, and chart revisions', () => {
  const hr = {
    metadata: { generation: 5 },
    spec: { suspend: true, chart: { spec: { version: '0.0.0-appliance.5411aa63' } } },
    status: {
      observedGeneration: 4,
      lastAttemptedRevision: '0.0.0-appliance.bf9f1327',
      conditions: [
        { type: 'Ready', status: 'False', reason: 'UpgradeFailed', message: 'boom' },
        { type: 'Stalled', status: 'True', reason: 'RetriesExceeded', message: 'upgrade retries exhausted' }
      ]
    }
  };
  const s = summarizeHelmRelease(hr);
  assert.equal(s.readable, true);
  assert.equal(s.ready, false);
  assert.equal(s.hardFailed, true);
  assert.equal(s.reason, 'RetriesExceeded');
  assert.equal(s.message, 'upgrade retries exhausted');
  assert.equal(s.suspended, true);
  assert.equal(s.observedCurrent, false);
  assert.equal(s.specChartVersion, '0.0.0-appliance.5411aa63');
  assert.equal(s.lastAttemptedRevision, '0.0.0-appliance.bf9f1327');

  assert.equal(summarizeHelmRelease({ status: {} }).readable, false);
  const progressing = summarizeHelmRelease({ metadata: { generation: 1 }, status: { observedGeneration: 1, conditions: [{ type: 'Ready', status: 'False', reason: 'Progressing' }] } });
  assert.equal(progressing.hardFailed, false);
  assert.equal(progressing.observedCurrent, true);
});

test('expectedChartVersions maps release names to the manifest chart pins', () => {
  const versions = expectedChartVersions({ charts: { sebastian: '1', temporal: '2' } });
  assert.equal(versions['alga-core'], '1');
  assert.equal(versions.temporal, '2');
  assert.equal(versions['email-service'], null);
  assert.deepEqual(Object.keys(versions).sort(), APPLIANCE_HELM_RELEASES.map((r) => r.name).sort());
});

test('setHelmReleasesSuspended patches each release and tolerates a missing one', async () => {
  const { calls, runKubectl } = stubKubectl([[ 'patch helmrelease \'ghost\'', notFound('helmrelease ghost') ]]);
  const result = await setHelmReleasesSuspended({ runKubectl, names: ['alga-core', 'ghost'], suspended: true });
  assert.equal(result.ok, true);
  assert.equal(calls[0], `-n 'alga-system' patch helmrelease 'alga-core' --field-manager=flux-client-side-apply --type merge -p '{"spec":{"suspend":true}}'`);
  const resumed = await setHelmReleasesSuspended({ runKubectl, names: ['alga-core'], suspended: false });
  assert.equal(resumed.ok, true);
  assert.match(calls.at(-1), /"suspend":null/);

  const denied = stubKubectl([[ 'patch helmrelease', () => ({ ok: false, stdout: '', stderr: 'forbidden' }) ]]);
  const failed = await setHelmReleasesSuspended({ runKubectl: denied.runKubectl, names: ['alga-core'], suspended: true });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.failures, [{ name: 'alga-core', error: 'forbidden' }]);
});

test('clearBootstrapJob is a no-op when no Job exists', async () => {
  const { calls, runKubectl } = stubKubectl([[ 'get job', notFound('jobs.batch "alga-core-sebastian-bootstrap"') ]]);
  const result = await clearBootstrapJob({ runKubectl });
  assert.deepEqual(result, { ok: true, existed: false, deleted: false, waitedForActive: false });
  assert.equal(calls.length, 1);
});

test('clearBootstrapJob deletes a finished Job and waits for the object to be gone', async () => {
  const { calls, runKubectl } = stubKubectl([[ 'get job', json({ status: { succeeded: 1 } }) ]]);
  const result = await clearBootstrapJob({ runKubectl });
  assert.equal(result.deleted, true);
  assert.equal(calls[1], `-n 'msp' delete job 'alga-core-sebastian-bootstrap' --ignore-not-found=true --wait=true`);
});

test('clearBootstrapJob gives a running Job time to finish, then deletes it; without a budget it deletes at once', async () => {
  let reads = 0;
  const active = stubKubectl([[ 'get job', () => { reads += 1; return json({ status: { active: reads < 3 ? 1 : 0 } })(); } ]]);
  const sleeps = [];
  const waited = await clearBootstrapJob({ runKubectl: active.runKubectl, sleep: async (ms) => sleeps.push(ms), waitForActiveMs: 60_000, pollMs: 7 });
  assert.equal(waited.waitedForActive, true);
  assert.equal(waited.deleted, true);
  assert.deepEqual(sleeps, [7, 7]);

  const immediate = stubKubectl([[ 'get job', json({ status: { active: 1 } }) ]]);
  const now = await clearBootstrapJob({ runKubectl: immediate.runKubectl, waitForActiveMs: 0 });
  assert.equal(now.waitedForActive, false);
  assert.equal(now.deleted, true);
});

test('recoverAppRelease resumes every release, clears the bootstrap Job, then forces a reset reconcile of alga-core', async () => {
  const { calls, runKubectl } = stubKubectl([[ 'get job', json({ status: { succeeded: 1 } }) ]]);
  const result = await recoverAppRelease({ runKubectl, at: '2026-09-18T14:22:56.000Z' });
  assert.equal(result.ok, true);
  assert.equal(result.clearedBootstrapJob, true);
  const resumes = calls.filter((c) => /"suspend":null/.test(c));
  assert.equal(resumes.length, APPLIANCE_HELM_RELEASES.length);
  const del = calls.findIndex((c) => /delete job 'alga-core-sebastian-bootstrap'/.test(c));
  const annotate = calls.findIndex((c) => /annotate helmrelease 'alga-core'/.test(c));
  assert.ok(calls.findIndex((c) => /"suspend":null/.test(c)) < del);
  assert.ok(del < annotate);
  assert.equal(calls[annotate], `-n 'alga-system' annotate helmrelease 'alga-core' reconcile.fluxcd.io/requestedAt='2026-09-18T14:22:56.000Z' reconcile.fluxcd.io/forceAt='2026-09-18T14:22:56.000Z' reconcile.fluxcd.io/resetAt='2026-09-18T14:22:56.000Z' --overwrite`);
});

test('recoverAppRelease reports which step failed', async () => {
  const { runKubectl } = stubKubectl([
    [ 'get job', json({ status: { succeeded: 1 } }) ],
    [ 'delete job', () => ({ ok: false, stdout: '', stderr: 'timed out waiting for deletion' }) ]
  ]);
  const result = await recoverAppRelease({ runKubectl });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'clear-bootstrap-job');
  assert.match(result.error, /timed out/);
});

// /api/recover must go through recoverAppRelease so the UI button is enough to
// clear a Stalled release (resetAt) and a leftover bootstrap Job without SSH.
test('server /api/recover uses the shared recovery (reset + force + bootstrap Job cleanup)', () => {
  const server = fs.readFileSync(serverPath, 'utf8');
  const recover = server.slice(server.indexOf("url.pathname === '/api/recover'"), server.indexOf("url.pathname === '/api/manage/status'"));
  assert.match(recover, /recoverAppRelease\(/);
  assert.doesNotMatch(recover, /annotate helmrelease/);
  assert.match(server, /import \{[^}]*recoverAppRelease[^}]*\} from '\.\/helm-release-recovery\.mjs'/);
});

test('nudgeChildKustomizations annotates every Kustomization owned by the top-level one', async () => {
  const { calls, runKubectl } = stubKubectl([[ 'get kustomizations', () => ({ ok: true, stdout: 'flux-system/alga-platform\nflux-system/alga-core\nflux-system/alga-background\n', stderr: '' }) ]]);
  const result = await nudgeChildKustomizations({ runKubectl, parentName: 'alga-appliance', at: 'T' });
  assert.deepEqual(result.nudged, ['flux-system/alga-platform', 'flux-system/alga-core', 'flux-system/alga-background']);
  assert.match(calls[0], /-l 'kustomize\.toolkit\.fluxcd\.io\/name=alga-appliance,kustomize\.toolkit\.fluxcd\.io\/namespace=flux-system'/);
  assert.equal(calls[1], `-n 'flux-system' annotate kustomizations.kustomize.toolkit.fluxcd.io 'alga-platform' reconcile.fluxcd.io/requestedAt='T' --overwrite`);
  const none = await nudgeChildKustomizations({ runKubectl: stubKubectl().runKubectl, parentName: 'alga-appliance' });
  assert.deepEqual(none.nudged, []);
});

// Both places that can discover a dead update engine must hand the
// HelmReleases back to Flux: the engine's own signal handler and the control
// plane's interrupted-update reconcile.
test('a killed engine and the control plane both resume the HelmReleases', () => {
  const engine = fs.readFileSync(path.join(import.meta.dirname, '..', 'update-engine.mjs'), 'utf8');
  const handler = engine.slice(engine.indexOf('const writeInterruptedState'), engine.indexOf("process.once('SIGTERM'"));
  assert.match(handler, /await resumeAppReleases\(/);
  const server = fs.readFileSync(serverPath, 'utf8');
  const coordinator = server.slice(server.indexOf('createUpdateCoordinator({'), server.indexOf('updateCoordinator.reconcile();'));
  assert.match(coordinator, /onInterrupted: async/);
  assert.match(coordinator, /setHelmReleasesSuspended\(/);
  assert.match(coordinator, /suspended: false/);
});
