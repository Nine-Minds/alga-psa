import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRuntimeObservationEvidence } from '../lib/runtime-observation-evidence.mjs';

function fixture() {
  const now = Date.parse('2026-09-08T00:00:00.000Z');
  const expectedTarget = { context: 'release-smoke', namespace: 'isolated', workloads: [
    { kind: 'Deployment', name: 'server' }, { kind: 'Deployment', name: 'email-service' },
  ] };
  return { now, expectedTarget, maxObservationAgeSeconds: 300, runtimeEvidence: {
    schemaVersion: 1, scope: 'kubernetes-runtime-image-observations', observedAt: new Date(now - 60000).toISOString(),
    target: structuredClone(expectedTarget), observations: [{ name: 'server', image: `registry.example.test/server@sha256:${'a'.repeat(64)}` }],
  } };
}

test('fresh observations match the exact target regardless of workload list ordering', () => {
  const input = fixture(); input.runtimeEvidence.target.workloads.reverse();
  const result = verifyRuntimeObservationEvidence(input);
  assert.equal(result.status, 'passed'); assert.equal(result.ageMs, 60000);
});

for (const [name, mutate] of [
  ['wrong context', x => { x.runtimeEvidence.target.context = 'other-cluster'; }],
  ['wrong namespace', x => { x.runtimeEvidence.target.namespace = 'other'; }],
  ['missing workload', x => { x.runtimeEvidence.target.workloads.pop(); }],
  ['duplicate workload', x => { x.runtimeEvidence.target.workloads.push(x.runtimeEvidence.target.workloads[0]); }],
  ['unapproved workload', x => { x.runtimeEvidence.target.workloads[0].name = 'different'; }],
  ['stale snapshot', x => { x.runtimeEvidence.observedAt = new Date(x.now - 300001).toISOString(); }],
  ['future snapshot', x => { x.runtimeEvidence.observedAt = new Date(x.now + 1).toISOString(); }],
  ['missing timestamp', x => { delete x.runtimeEvidence.observedAt; }],
  ['invalid timestamp', x => { x.runtimeEvidence.observedAt = 'yesterday'; }],
  ['missing policy age', x => { delete x.maxObservationAgeSeconds; }],
  ['negative policy age', x => { x.maxObservationAgeSeconds = -1; }],
  ['missing policy target', x => { delete x.expectedTarget; }],
  ['legacy bare array', x => { x.runtimeEvidence = x.runtimeEvidence.observations; }],
  ['unsupported envelope', x => { x.runtimeEvidence.schemaVersion = 2; }],
  ['empty observations', x => { x.runtimeEvidence.observations = []; }],
]) test(`rejects ${name} even when component image values are unchanged`, () => {
  const input = fixture(); mutate(input);
  assert.equal(verifyRuntimeObservationEvidence(input).status, 'failed');
});

test('age threshold uses milliseconds without rounding expired snapshots into eligibility', () => {
  const input = fixture(); input.runtimeEvidence.observedAt = new Date(input.now - 300000).toISOString();
  assert.equal(verifyRuntimeObservationEvidence(input).status, 'passed');
  input.now++; assert.equal(verifyRuntimeObservationEvidence(input).status, 'failed');
});
