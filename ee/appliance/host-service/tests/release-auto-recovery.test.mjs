import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReleaseAutoRecovery,
  failedResourcesFromMessage,
  planReleaseAutoRecovery,
  summarizeAutoRecoveryRecord
} from '../release-auto-recovery.mjs';
import { collectStatusSnapshotAsync } from '../status-engine.mjs';

// Shapes copied from the field appliance on 2026-10-05: three background
// releases stalled on revision 4 because their Deployments missed the 600s
// progress deadline mid-upgrade, then finished rolling out.
const CHART = '0.0.0-appliance.ab65953d';

function stalledRelease(name, { version = 4, message } = {}) {
  return {
    metadata: { name, namespace: 'alga-system', generation: 3 },
    spec: { releaseName: name, targetNamespace: 'msp', chart: { spec: { version: CHART } } },
    status: {
      observedGeneration: 3,
      conditions: [
        { type: 'Stalled', status: 'True', reason: 'RetriesExceeded', message: 'Failed to upgrade after 1 attempt(s)' },
        { type: 'Ready', status: 'Unknown', reason: 'Progressing', message: 'reconciliation in progress' },
        {
          type: 'Released',
          status: 'False',
          reason: 'UpgradeFailed',
          message: message || `Helm upgrade failed for release msp/${name} with chart ${name}@${CHART}: failed early due to stalled resources: [Deployment/msp/${name} status: 'Failed']`
        }
      ],
      history: [{ name, namespace: 'msp', version, status: 'failed', chartVersion: CHART }]
    }
  };
}

function readyRelease(name, version) {
  return {
    metadata: { name, namespace: 'alga-system', generation: 3 },
    spec: { releaseName: name, targetNamespace: 'msp' },
    status: {
      observedGeneration: 3,
      conditions: [{ type: 'Ready', status: 'True', reason: 'UpgradeSucceeded', message: `Helm upgrade succeeded for release msp/${name}.v${version}` }],
      history: [{ name, namespace: 'msp', version, status: 'deployed', chartVersion: CHART }]
    }
  };
}

function deployment(name, { replicas = 1, available = replicas, updated = replicas, progressing = 'NewReplicaSetAvailable', release = name } = {}) {
  return {
    metadata: {
      name,
      namespace: 'msp',
      generation: 3,
      annotations: { 'meta.helm.sh/release-name': release, 'meta.helm.sh/release-namespace': 'msp' }
    },
    spec: { replicas },
    status: {
      observedGeneration: 3,
      replicas,
      updatedReplicas: updated,
      readyReplicas: available,
      availableReplicas: available,
      conditions: [{ type: 'Progressing', status: progressing === 'ProgressDeadlineExceeded' ? 'False' : 'True', reason: progressing }]
    }
  };
}

test('failure messages name the resources Helm was waiting on', () => {
  assert.deepEqual(
    failedResourcesFromMessage("failed early due to stalled resources: [Deployment/msp/email-service status: 'Failed', StatefulSet/msp/db status: 'InProgress']"),
    [
      { kind: 'Deployment', namespace: 'msp', name: 'email-service', status: 'Failed' },
      { kind: 'StatefulSet', namespace: 'msp', name: 'db', status: 'InProgress' }
    ]
  );
});

test('a release stalled on a rollout timeout is re-run only once its workloads are healthy', () => {
  const helmReleases = [stalledRelease('email-service'), stalledRelease('workflow-worker')];
  const plan = planReleaseAutoRecovery({
    helmReleases,
    workloads: {
      deployments: [
        deployment('email-service'),
        deployment('workflow-worker', { replicas: 2, available: 1 })
      ]
    }
  });
  assert.deepEqual(plan.candidates.map((c) => c.release), ['email-service']);
  assert.deepEqual(plan.candidates[0].verified, ['Deployment/msp/email-service']);
  assert.equal(plan.candidates[0].failedRevision, 4);
  assert.equal(plan.deferred.length, 1);
  assert.equal(plan.deferred[0].release, 'workflow-worker');
  assert.match(plan.deferred[0].reason, /waiting for Deployment\/msp\/workflow-worker, which has 1\/2 available/);
});

test('failures that a re-run would repeat, or that already had their re-run, are left for an operator', () => {
  const immutable = stalledRelease('email-service', {
    message: 'Helm upgrade failed for release msp/email-service: cannot patch "email-service" with kind Deployment: spec.selector: field is immutable'
  });
  const onJob = stalledRelease('temporal-worker', {
    message: "Helm upgrade failed: failed early due to stalled resources: [Job/msp/temporal-worker-migrate status: 'Failed']"
  });
  const deadline = stalledRelease('workflow-worker');
  const plan = planReleaseAutoRecovery({
    helmReleases: [immutable, onJob, deadline],
    workloads: {
      deployments: [
        deployment('email-service'),
        deployment('temporal-worker'),
        deployment('workflow-worker', { progressing: 'ProgressDeadlineExceeded' })
      ]
    },
    record: { attempts: [] }
  });
  assert.equal(plan.candidates.length, 0);
  const reasons = Object.fromEntries(plan.deferred.map((d) => [d.release, d.reason]));
  assert.match(reasons['email-service'], /not a rollout timeout/);
  assert.match(reasons['temporal-worker'], /Job\/msp\/temporal-worker-migrate, not a workload rollout/);
  assert.match(reasons['workflow-worker'], /is not progressing \(ProgressDeadlineExceeded\)/);

  const again = planReleaseAutoRecovery({
    helmReleases: [stalledRelease('workflow-worker')],
    workloads: { deployments: [deployment('workflow-worker')] },
    record: { attempts: [{ release: 'workflow-worker', failedRevision: 4, at: '2026-10-05T22:40:00.000Z', outcome: 'failed-again' }] }
  });
  assert.equal(again.candidates.length, 0);
  assert.match(again.deferred[0].reason, /revision 4 was already re-run automatically/);
});

test('the runner resets healthy stalled releases, records why, and later notes that they recovered', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-auto-recovery-'));
  const stateFile = path.join(dir, 'install-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ status: 'ready', phase: 'registry-release-source' }));
  const names = ['email-service', 'temporal-worker', 'workflow-worker'];
  let helmReleases = [readyRelease('alga-core', 6), readyRelease('pgbouncer', 2), readyRelease('temporal', 4), ...names.map((name) => stalledRelease(name))];
  const ok = (items) => async () => ({ ok: true, items });
  const clusterReader = {
    listHelmReleases: async () => ({ ok: true, items: helmReleases }),
    listDeployments: ok([deployment('alga-core-sebastian', { release: 'alga-core' }), ...names.map((name) => deployment(name))]),
    listStatefulSets: ok([]),
    listDaemonSets: ok([]),
    listJobs: ok([]),
    listNodes: ok([{ metadata: { name: 'alga-psa' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }]),
    listPods: ok([]),
    listEvents: ok([])
  };
  const kubectl = [];
  let clock = Date.parse('2026-10-05T22:30:00.000Z');
  let changes = 0;
  const runner = createReleaseAutoRecovery({
    clusterReader,
    runKubectl: async (args) => { kubectl.push(args); return { ok: true, stdout: '', stderr: '' }; },
    stateFile,
    now: () => clock,
    onChange: () => { changes += 1; },
    logger: { info() {}, error() {} }
  });

  const first = await runner.runOnce('startup');
  // Dependency order (APPLIANCE_HELM_RELEASES), not listing order.
  assert.deepEqual(first.recovered, ['temporal-worker', 'workflow-worker', 'email-service']);
  const annotations = kubectl.filter((args) => args.includes('annotate helmrelease'));
  assert.equal(annotations.length, 3);
  for (const args of annotations) {
    assert.match(args, /reconcile\.fluxcd\.io\/forceAt=/);
    assert.match(args, /reconcile\.fluxcd\.io\/resetAt=/);
  }
  assert.ok(!kubectl.some((args) => /alga-core/.test(args)), 'a healthy release is never touched');
  assert.equal(changes, 1);

  // While Flux works, the Overview says so instead of asking for a manual reset.
  const snapshot = await collectStatusSnapshotAsync({
    stateFile,
    clusterReader,
    releaseAutoRecovery: () => summarizeAutoRecoveryRecord(runner.readRecord(), { nowMs: clock })
  });
  const flux = snapshot.topBlockers.find((blocker) => blocker.component === 'flux');
  assert.match(flux.reason, /email-service: Failed to upgrade after 1 attempt\(s\): Helm upgrade failed/);
  assert.match(flux.reason, /re-run automatically at 2026-10-05T22:30:00.000Z: revision 4 failed only on a rollout timeout and Deployment\/msp\/email-service became healthy afterwards/);
  assert.match(flux.nextAction, /^No action needed/);

  // A second tick while Flux has not finished does not reset again.
  clock += 2 * 60 * 1000;
  await runner.runOnce('periodic');
  assert.equal(kubectl.filter((args) => args.includes('annotate helmrelease')).length, 3);

  // Flux upgrades each release to revision 5: the next tick records the outcome.
  helmReleases = [readyRelease('alga-core', 6), readyRelease('pgbouncer', 2), readyRelease('temporal', 4), ...names.map((name) => readyRelease(name, 5))];
  clock += 2 * 60 * 1000;
  await runner.runOnce('periodic');
  const summary = summarizeAutoRecoveryRecord(runner.readRecord(), { nowMs: clock });
  assert.deepEqual(summary.recent.map((a) => [a.release, a.outcome, a.recoveredRevision]).sort(), [
    ['email-service', 'recovered', 5],
    ['temporal-worker', 'recovered', 5],
    ['workflow-worker', 'recovered', 5]
  ]);
  assert.equal(summary.recent[0].failedRevision, 4);
  assert.match(summary.recent[0].failure, /failed early due to stalled resources/);

  const healthy = await collectStatusSnapshotAsync({
    stateFile,
    clusterReader,
    releaseAutoRecovery: () => summarizeAutoRecoveryRecord(runner.readRecord(), { nowMs: clock })
  });
  assert.equal(healthy.topBlockers.some((blocker) => blocker.component === 'flux'), false);
  assert.equal(healthy.releaseAutoRecovery.recent.length, 3);
});

test('the runner stands down while setup or an app update owns the releases', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-auto-recovery-skip-'));
  const kubectl = [];
  const runner = createReleaseAutoRecovery({
    clusterReader: { listHelmReleases: async () => { throw new Error('must not read'); } },
    runKubectl: async (args) => { kubectl.push(args); return { ok: true }; },
    stateFile: path.join(dir, 'install-state.json'),
    shouldSkip: () => 'an app update is in progress (update-running)',
    logger: { info() {}, error() {} }
  });
  const result = await runner.runOnce('periodic');
  assert.equal(result.skipped, 'an app update is in progress (update-running)');
  assert.equal(kubectl.length, 0);
  assert.equal(runner.readRecord().lastCheck.outcome, 'skipped');
});
