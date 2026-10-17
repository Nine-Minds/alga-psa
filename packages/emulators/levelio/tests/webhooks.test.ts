import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startLevel, startReceiver } from './helpers';

let level: Awaited<ReturnType<typeof startLevel>>;
let receiver: Awaited<ReturnType<typeof startReceiver>>;

/** Level's published Node.js verification snippet, verbatim in behavior. */
function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  const receivedSignature = signature.replace('sha256=', '');
  return crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(receivedSignature, 'hex'));
}

beforeAll(async () => {
  level = await startLevel();
  receiver = await startReceiver();
});

afterAll(async () => {
  await level.host.stop();
  await receiver.close();
});

beforeEach(async () => {
  await level.reset();
  // Deterministic retries: the test pumps them with deliver-due-retries.
  await level.action('configure', { autoRetry: false });
  receiver.received.length = 0;
  receiver.respondWith(() => ({ status: 200, body: '{"ok":true}' }));
});

describe('Level native webhooks', () => {
  it('posts the documented envelope with a verifiable X-Level-Signature when a secret is set', async () => {
    await level.seed('webhook', { url: `${receiver.url}/hook`, secret: 'level-secret', eventTypes: ['alert_active'] });
    const device = (await level.seed('device', { hostname: 'WS-01' })).device;
    const fired = await level.action('fire-alert', { deviceId: device.id, name: 'Low disk space', description: 'Disk free < 5.0%', severity: 'critical' });

    expect(receiver.received).toHaveLength(1);
    const [request] = receiver.received;
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toBe('application/json');
    const signature = String(request.headers['x-level-signature']);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhook(request.rawBody, signature, 'level-secret')).toBe(true);
    expect(verifyWebhook(request.rawBody, signature, 'other-secret')).toBe(false);

    const body = JSON.parse(request.rawBody);
    expect(Object.keys(body)).toEqual(['event_type', 'event_id', 'occurred_at', 'data']);
    expect(body).toMatchObject({
      event_type: 'alert_active',
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      data: { id: fired.alert.id, device_id: device.id, device_hostname: 'WS-01', name: 'Low disk space', severity: 'critical', is_resolved: false },
    });
    // Native webhooks cannot carry custom headers, so Alga's shared-secret header never arrives.
    expect(request.headers['x-alga-webhook-secret']).toBeUndefined();
    // The device_created event was not selected for this endpoint.
    expect((await level.state('events')).map((e: { event_type: string }) => e.event_type)).toEqual(['device_created', 'alert_active']);
  });

  it('sends no signature header when the endpoint has no secret', async () => {
    await level.seed('webhook', { url: `${receiver.url}/hook` });
    await level.seed('group', { name: 'Acme' });
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0].headers['x-level-signature']).toBeUndefined();
    expect(JSON.parse(receiver.received[0].rawBody)).toMatchObject({ event_type: 'group_created', data: { name: 'Acme', child_ids: [] } });
  });

  it('emits every documented event type through the lifecycle controls', async () => {
    await level.seed('webhook', { url: `${receiver.url}/hook` });
    const group = (await level.seed('group', { name: 'Acme' })).group;
    const device = (await level.seed('device', { hostname: 'WS-01', groupId: group.id })).device;
    await level.action('update-device', { deviceId: device.id, patch: { nickname: 'Front desk' } });
    const alert = (await level.action('fire-alert', { deviceId: device.id, name: 'CPU' })).alert;
    await level.action('resolve-alert', { alertId: alert.id });
    await level.action('update-group', { groupId: group.id, name: 'Acme Corp' });
    await level.action('delete-device', { deviceId: device.id });
    await level.action('delete-group', { groupId: group.id });

    expect(receiver.received.map((r) => JSON.parse(r.rawBody).event_type)).toEqual([
      'group_created', 'device_created', 'device_updated', 'alert_active', 'alert_resolved',
      'group_updated', 'device_deleted', 'group_deleted',
    ]);
    const resolved = JSON.parse(receiver.received[4].rawBody).data;
    expect(resolved).toMatchObject({ is_resolved: true, resolved_at: expect.any(String) });
  });

  it('retries a failing endpoint up to 3 times with growing backoff and a stable event_id', async () => {
    await level.seed('webhook', { url: `${receiver.url}/hook`, secret: 's3cret', eventTypes: ['alert_active'] });
    const device = (await level.seed('device', { hostname: 'WS-01' })).device;
    receiver.respondWith(() => ({ status: 401, body: '{"error":"Unauthorized"}' }));
    await level.action('fire-alert', { deviceId: device.id, name: 'CPU' });

    // Not due yet: retries wait at least two minutes.
    expect(await level.action('deliver-due-retries')).toEqual([]);
    const gaps: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const [pending] = await level.state('pending-retries');
      gaps.push(pending.dueAtMs - level.host.clock.now().getTime());
      level.host.clock.advance(pending.dueAtMs - level.host.clock.now().getTime());
      expect(await level.action('deliver-due-retries')).toHaveLength(1);
    }
    expect(gaps[0]).toBeGreaterThanOrEqual(2 * 60_000);
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
    expect(gaps[2]).toBeGreaterThan(gaps[1]);

    level.host.clock.advance('1d');
    expect(await level.action('deliver-due-retries')).toEqual([]);
    expect(await level.state('pending-retries')).toEqual([]);

    const deliveries = await level.state('webhook-deliveries');
    expect(deliveries.map((d: any) => [d.trigger, d.attempt, d.status])).toEqual([
      ['initial', 1, 401], ['retry', 2, 401], ['retry', 3, 401], ['retry', 4, 401],
    ]);
    const bodies = receiver.received.map((r) => r.rawBody);
    expect(new Set(bodies).size).toBe(1); // same event_id, same bytes, same signature
    expect(new Set(receiver.received.map((r) => r.headers['x-level-signature'])).size).toBe(1);
  });

  it('stops retrying once the endpoint answers 2xx, and treats redirects as failures', async () => {
    await level.seed('webhook', { url: `${receiver.url}/hook`, eventTypes: ['group_created'] });
    let calls = 0;
    receiver.respondWith(() => (++calls === 1 ? { status: 302 } : { status: 204 }));
    await level.seed('group', { name: 'Acme' });
    const [pending] = await level.state('pending-retries');
    level.host.clock.advance(pending.dueAtMs - level.host.clock.now().getTime());
    await level.action('deliver-due-retries');
    expect((await level.state('webhook-deliveries')).map((d: any) => [d.status, d.ok])).toEqual([[302, false], [204, true]]);
    expect(await level.state('pending-retries')).toEqual([]);
  });

  it('re-runs a recorded delivery with the same event_id and bytes', async () => {
    await level.seed('webhook', { url: `${receiver.url}/hook`, secret: 'k', eventTypes: ['device_created'] });
    await level.seed('device', { hostname: 'WS-01' });
    const [first] = await level.state('webhook-deliveries');
    const rerun = await level.action('rerun-delivery', { deliveryId: first.id });
    expect(rerun).toMatchObject({ trigger: 'rerun', eventId: first.eventId, status: 200 });
    expect(receiver.received[1].rawBody).toBe(receiver.received[0].rawBody);
  });

  it('delivers due retries in the background as time passes when autoRetry is on', async () => {
    await level.action('configure', { autoRetry: true, retryBaseDelayMs: 0, retryJitterMs: 0 });
    await level.seed('webhook', { url: `${receiver.url}/hook`, eventTypes: ['group_created'] });
    receiver.respondWith(() => ({ status: 500 }));
    await level.seed('group', { name: 'Acme' });
    await expect.poll(() => receiver.received.length, { timeout: 5_000 }).toBe(4);
  });

  it('merges configurable, unverified extra alert fields into webhook data only', async () => {
    await level.seed('webhook', { url: `${receiver.url}/hook`, eventTypes: ['alert_active'] });
    const device = (await level.seed('device', { hostname: 'WS-01' })).device;
    const { alert } = await level.action('fire-alert', {
      deviceId: device.id, name: 'CPU', webhookDataExtra: { group_id: 'g-1', monitor_id: 'm-1' },
    });
    expect(JSON.parse(receiver.received[0].rawBody).data).toMatchObject({ id: alert.id, group_id: 'g-1', monitor_id: 'm-1' });
    expect((await level.state('alerts'))[0].group_id).toBeUndefined();
  });
});
