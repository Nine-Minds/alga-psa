import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { NotificationExtension } from '../../../../../hocuspocus/NotificationExtension.js';
import { validateDocumentRoomAccess } from '../../../../../hocuspocus/tenantValidation.js';

const tenant = randomUUID(), user = randomUUID(), sessionId = randomUUID();
const secret = 'notification-signal-test-secret';
const room = `notification-signals:${tenant}:${user}`;
function request(overrides = {}, ttl = 60, signingSecret = secret) {
  const token = jwt.sign({ scope: 'notification-signals', tenantId: tenant, userId: user, sessionId, ...overrides }, signingSecret,
    { expiresIn: ttl, algorithm: 'HS256', audience: 'notification-signals' });
  return new Request(`http://localhost/hocuspocus?token=${token}`);
}
function harness() {
  const handlers = new Map<string, () => Promise<void>>();
  const redis = { on: vi.fn((name, fn) => { handlers.set(name, fn); }), connect: vi.fn(async () => { await handlers.get('ready')?.(); }),
    pSubscribe: vi.fn(async () => {}), quit: vi.fn(async () => {}) };
  const broadcastStateless = vi.fn();
  const document = { broadcastStateless, getMap: vi.fn(() => { throw new Error('Notification bodies must never enter Yjs'); }) };
  const extension = new NotificationExtension({ redisPrefix: 'test:', createClient: () => redis });
  return { extension, redis, handlers, document, instance: { documents: new Map([[room, document]]) }, broadcastStateless };
}

describe('authenticated notification refresh signals', () => {
  beforeEach(() => { process.env.HOCUSPOCUS_JWT_SECRET = secret; });
  it('binds the room to a short-lived notification-purpose token and makes it read-only', async () => {
    const { extension } = harness();
    const connection = { readOnly: false };
    const context = await extension.onConnect({ documentName: room, request: request(), connection });
    expect(connection.readOnly).toBe(true);
    expect(context.notificationSignals).toMatchObject({ tenantId: tenant, userId: user });
    expect(validateDocumentRoomAccess(room, request())).toMatchObject({ status: 'ok' });
    await expect(extension.onConnect({ documentName: room, request: new Request('http://localhost'), connection })).rejects.toThrow('missing token');
  });
  it.each([{ tenantId: randomUUID() }, { userId: randomUUID() }, { sessionId: 'not-a-session' }, { scope: 'ticket' }])('rejects a mismatched token %j', overrides => {
    expect(() => validateDocumentRoomAccess(room, request(overrides))).toThrow();
  });
  it('rejects expired, oversized-lifetime and incorrectly signed tokens', () => {
    expect(() => validateDocumentRoomAccess(room, request({}, -1))).toThrow();
    expect(() => validateDocumentRoomAccess(room, request({}, 61))).toThrow();
    expect(() => validateDocumentRoomAccess(room, request({}, 60, 'wrong'))).toThrow();
  });
  it('broadcasts only a constant refresh hint to currently authorized matching connections', async () => {
    const { extension, instance, redis, broadcastStateless, document } = harness();
    await extension.onConfigure({ instance });
    expect(redis.pSubscribe).toHaveBeenCalledTimes(1);
    for (const type of ['notification.created', 'notification.read', 'notifications.all_read', 'notifications.unread_count']) {
      await extension.handleMessage(JSON.stringify({ type, notification: { message: 'Private canary' }, notificationId: 'secret-id', unreadCount: 99 }), `test:internal-notifications:${tenant}:${user}`);
    }
    expect(broadcastStateless).toHaveBeenCalledTimes(4);
    const [payload, filter] = broadcastStateless.mock.calls[0];
    expect(JSON.parse(payload)).toEqual({ type: 'notifications.changed' });
    const access = { tenantId: tenant, userId: user, expiresAt: Date.now() + 5000 };
    expect(filter({ context: { notificationSignals: access } })).toBe(true);
    expect(filter({ context: { notificationSignals: { ...access, userId: randomUUID() } } })).toBe(false);
    expect(filter({ context: { notificationSignals: { ...access, expiresAt: Date.now() - 1 } } })).toBe(false);
    expect(filter({ context: {} })).toBe(false);
    expect(document.getMap).not.toHaveBeenCalled();
    await expect(extension.beforeHandleMessage({ documentName: room, context: { notificationSignals: { ...access, expiresAt: 0 } } })).rejects.toThrow('expired');
    await extension.onDestroy(); expect(redis.quit).toHaveBeenCalledOnce();
  });
  it('re-subscribes after Redis reconnect and ignores unmatched rooms or unknown events', async () => {
    const { extension, instance, redis, handlers, broadcastStateless } = harness();
    await extension.onConfigure({ instance });
    await handlers.get('end')?.(); await handlers.get('ready')?.();
    expect(redis.pSubscribe).toHaveBeenCalledTimes(2);
    await extension.handleMessage(JSON.stringify({ type: 'notification.created' }), `test:internal-notifications:${tenant}:${randomUUID()}`);
    await extension.handleMessage(JSON.stringify({ type: 'unrecognized' }), `test:internal-notifications:${tenant}:${user}`);
    expect(broadcastStateless).not.toHaveBeenCalled();
  });
});
