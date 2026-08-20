import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SupportSessionError, SupportSessionManager, normalizeSupportDuration, supportCapability } from '../support-session-manager.mjs';
import { buildSupportConnectorSecret, buildSupportPod, isValidSupportAgentImage, SUPPORT_NAMESPACE } from '../support-kubernetes.mjs';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const IMAGE = `ghcr.io/nine-minds/alga-appliance-support-agent@sha256:${'a'.repeat(64)}`;

function fakeCentral() {
  const calls = [];
  return {
    configured: true,
    calls,
    async createSession({ durationHours }) {
      calls.push(['create', durationHours]);
      const activatedAt = new Date().toISOString();
      return { sessionId: SESSION_ID, shareCode: 'ABCDE-FGHJK', connectorToken: 'connector-token-123456', applianceToken: 'appliance-token-123456', resumeGrant: 'resume-grant-123456', statusUrl: 'https://support.example/v1/appliance/sessions/1', relayUrl: 'wss://relay.example/v1/sessions/1', activatedAt, expiresAt: new Date(Date.now() + durationHours * 3600000).toISOString() };
    },
    async acknowledge(id) { calls.push(['ack', id]); return { ok: true }; },
    async abandon(id) { calls.push(['abandon', id]); return { ok: true }; },
    async getSession() { return { active: true, state: 'ready', applianceReady: true, recorderReady: true }; },
    async extend(id, token, durationHours) { calls.push(['extend', durationHours]); return { expiresAt: new Date(Date.now() + durationHours * 3600000 - 1000).toISOString() }; },
    async revoke(id) { calls.push(['revoke', id]); return { ok: true }; },
    async resume() { calls.push(['resume']); return { connectorToken: 'connector-token-123456' }; },
  };
}

function fakeKube() {
  const calls = [];
  return {
    calls,
    async apply(value) { calls.push(['apply', value]); return { ok: true }; },
    async delete(kind, name, namespace) { calls.push(['delete', kind, name, namespace]); return { ok: true }; },
    async getPod() { return { metadata: { name: `support-${SESSION_ID}` } }; },
    async listSupportPods() { return []; },
  };
}

function manager(tmp, overrides = {}) {
  return new SupportSessionManager({
    stateDir: path.join(tmp, 'support-sessions'),
    central: fakeCentral(),
    kube: fakeKube(),
    getLicense: async () => ({ edition: 'pro', status: 'active', source: 'live' }),
    getCredential: async () => 'long-lived-appliance-credential',
    getSupportAgentImage: async () => IMAGE,
    waitForReadiness: async () => ({ ready: true, recorderReady: true }),
    ...overrides,
  });
}

test('capability distinguishes Pro connectivity, central readiness, and immutable image', () => {
  assert.equal(supportCapability({ license: { edition: 'essentials' }, centralConfigured: true, supportAgentImage: IMAGE }).reason, 'pro_required');
  assert.equal(supportCapability({ license: { edition: 'pro', status: 'active', source: 'seed-fallback' }, centralConfigured: true, supportAgentImage: IMAGE }).reason, 'connected_appliance_required');
  assert.equal(supportCapability({ license: { edition: 'pro', status: 'active', source: 'live' }, centralConfigured: false, supportAgentImage: IMAGE }).reason, 'central_service_unavailable');
  assert.equal(supportCapability({ license: { edition: 'pro', status: 'active', source: 'live' }, centralConfigured: true, supportAgentImage: null }).reason, 'control_plane_update_required');
  assert.equal(supportCapability({ license: { edition: 'pro', status: 'active', source: 'live' }, centralConfigured: true, supportAgentImage: IMAGE }).eligible, true);
});

test('duration validation and pod contract are strict', () => {
  assert.equal(normalizeSupportDuration('4'), 4);
  assert.throws(() => normalizeSupportDuration(2), (error) => error instanceof SupportSessionError && error.code === 'invalid_duration');
  assert.equal(isValidSupportAgentImage(IMAGE), true);
  assert.equal(isValidSupportAgentImage('ghcr.io/nine-minds/alga-appliance-support-agent:latest'), false);
  assert.equal(isValidSupportAgentImage(`ghcr.io/nine-minds/alga-appliance-support-agent@sha256:${'a'.repeat(63)}`), false);
  const session = { sessionId: SESSION_ID, relayUrl: 'wss://relay.example', expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const secret = buildSupportConnectorSecret({ sessionId: SESSION_ID, connectorToken: 'connector-token-123456' });
  const pod = buildSupportPod({ session, supportAgentImage: IMAGE });
  assert.equal(secret.metadata.namespace, SUPPORT_NAMESPACE);
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.hostPID, true);
  assert.equal(pod.spec.containers[0].securityContext.privileged, true);
  assert.equal(pod.spec.containers[0].imagePullPolicy, 'IfNotPresent');
  assert.equal(pod.spec.containers[0].env.some((entry) => entry.name.includes('CREDENTIAL')), false);
  assert.equal(pod.spec.containers[0].ports, undefined);
  assert.equal(pod.spec.volumes.find((volume) => volume.name === 'reconnect-token').emptyDir.medium, 'Memory');
  assert.equal(pod.spec.containers[0].env.find((entry) => entry.name === 'SUPPORT_RECORDING_OWNER_UID').value, '10001');
  assert.equal(pod.spec.containers[0].env.find((entry) => entry.name === 'SUPPORT_RECORDING_OWNER_GID').value, '10001');
});

test('create is durable, readiness-gated, one-active, and revoke wins locally', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-'));
  const central = fakeCentral();
  const kube = fakeKube();
  const service = manager(tmp, { central, kube });
  const created = await service.create({ durationHours: 1 });
  assert.equal(created.state, 'ready');
  assert.equal(created.shareCode, 'ABCDE-FGHJK');
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'support-sessions', 'active.json'), 'utf8'));
  assert.equal(stored.applianceToken, 'appliance-token-123456');
  assert.equal(stored.shareCode, 'ABCDE-FGHJK');
  assert.equal(stored.credential, undefined);
  await assert.rejects(() => service.create({ durationHours: 4 }), (error) => error.code === 'already_active');
  const extended = await service.extend(SESSION_ID, 4);
  assert.equal(extended.durationHours, 4);
  const closed = await service.revoke(SESSION_ID);
  assert.equal(closed.state, 'revoked');
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'revoked', `${SESSION_ID}.json`)), true);
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'active.json')), false);
  assert.equal(kube.calls.some((call) => call[0] === 'delete' && call[1] === 'pod'), true);
});

test('acknowledged provisioning failure revokes central session and removes local authority', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-failure-'));
  const central = fakeCentral();
  const kube = fakeKube();
  const service = manager(tmp, { central, kube, waitForReadiness: async () => ({ ready: false, recorderReady: false }) });
  service._provision = async () => { throw new SupportSessionError('provisioning_timeout', 'not ready', 504); };
  await assert.rejects(() => service.create({ durationHours: 4 }), (error) => error.code === 'provisioning_timeout');
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'active.json')), false);
  assert.equal(central.calls.some((call) => call[0] === 'revoke'), true);
});

test('cleanup failure keeps active authority and central revoke remains retryable', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-cleanup-'));
  const central = fakeCentral();
  const kube = fakeKube();
  let failCleanup = true;
  kube.delete = async (kind, name, namespace) => { kube.calls.push(['delete', kind, name, namespace]); if (failCleanup && kind === 'pod') throw new Error('pod deletion failed'); return { ok: true }; };
  central.revoke = async (...args) => { central.calls.push(['revoke', ...args]); throw new Error('central unavailable'); };
  const service = manager(tmp, { central, kube });
  await service.create({ durationHours: 1 });
  await assert.rejects(() => service.revoke(SESSION_ID), (error) => error.code === 'cleanup_failure');
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'active.json')), true);
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'close-pending', `${SESSION_ID}.json`)), true);
  failCleanup = false;
  central.revoke = async (...args) => { central.calls.push(['revoke-retry', ...args]); return { ok: true }; };
  const result = await service.reconcileStartup();
  assert.equal(result.state, 'closed');
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'active.json')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'close-pending', `${SESSION_ID}.json`)), false);
});

test('central authority URLs and expiry cannot exceed the requested or absolute window', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-authority-'));
  const central = fakeCentral();
  central.createSession = async ({ durationHours }) => {
    const activatedAt = new Date().toISOString();
    return { sessionId: SESSION_ID, shareCode: 'ABCDE-FGHJK', connectorToken: 'connector-token-123456', applianceToken: 'appliance-token-123456', resumeGrant: 'resume-grant-123456', statusUrl: 'http://support.example/status', relayUrl: 'ws://relay.example/session', activatedAt, expiresAt: new Date(Date.now() + durationHours * 3600000).toISOString() };
  };
  const service = manager(tmp, { central });
  await assert.rejects(() => service.create({ durationHours: 1 }), (error) => error.code === 'central_invalid_response');
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'active.json')), false);
  assert.equal(central.calls.some((call) => call[0] === 'abandon'), true);
});

test('readiness requires both live agent and recorder signals', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-readiness-'));
  let now = Date.now();
  const service = manager(tmp, { now: () => now, waitForReadiness: async () => { now += 61 * 1000; return { ready: true }; } });
  const descriptor = { sessionId: SESSION_ID, relayUrl: 'wss://relay.example', expiresAt: new Date(now + 3600000).toISOString() };
  await assert.rejects(() => service._provision(descriptor, 'connector-token-123456', IMAGE), (error) => error.code === 'provisioning_timeout');
});

test('extension recreates the pod deadline and startup resume uses the persisted image digest', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-extension-'));
  const central = fakeCentral();
  const kube = fakeKube();
  const service = manager(tmp, { central, kube });
  await service.create({ durationHours: 1 });
  await service.extend(SESSION_ID, 4);
  const podApplies = kube.calls.filter((call) => call[0] === 'apply' && call[1]?.kind === 'Pod');
  assert.equal(podApplies.at(-1)[1].spec.activeDeadlineSeconds > 3 * 3600, true);
  const activeFile = path.join(tmp, 'support-sessions', 'active.json');
  const active = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
  active.state = 'provisioning';
  fs.writeFileSync(activeFile, `${JSON.stringify(active)}\n`, { mode: 0o600 });
  kube.getPod = async () => null;
  const resumed = manager(tmp, { central, kube, getSupportAgentImage: async () => `${IMAGE.replace(/a+$/, 'b'.repeat(64))}` });
  const result = await resumed.reconcileStartup();
  assert.equal(result.ok, true);
  const resumedPod = kube.calls.filter((call) => call[0] === 'apply' && call[1]?.kind === 'Pod').at(-1)[1];
  assert.equal(resumedPod.spec.containers[0].image, IMAGE);
});

test('startup reconciliation expires stale state and prunes only closed recordings', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-reconcile-'));
  let now = Date.now();
  const service = manager(tmp, { now: () => now });
  await service.create({ durationHours: 1 });
  now += 2 * 60 * 60 * 1000;
  const result = await service.reconcileStartup();
  assert.equal(result.state, 'expired');
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'active.json')), false);
});

test('runtime reconciliation retries closing cleanup without restart', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'support-session-runtime-reconcile-'));
  const central = fakeCentral();
  const kube = fakeKube();
  let failCleanup = true;
  kube.delete = async (kind, name, namespace) => { if (failCleanup && kind === 'pod') throw new Error('temporary cleanup failure'); return { ok: true }; };
  const service = manager(tmp, { central, kube, reconciliationIntervalMs: 10 });
  await service.create({ durationHours: 1 });
  await assert.rejects(() => service.revoke(SESSION_ID), (error) => error.code === 'cleanup_failure');
  failCleanup = false;
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(fs.existsSync(path.join(tmp, 'support-sessions', 'active.json')), false);
});
