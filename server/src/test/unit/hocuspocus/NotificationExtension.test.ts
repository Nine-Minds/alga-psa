import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import { NotificationExtension } from '../../../../../hocuspocus/NotificationExtension.js';
import { validateDocumentRoomAccess } from '../../../../../hocuspocus/tenantValidation.js';

const tenant = randomUUID(), user = randomUUID(), sessionId = randomUUID();
const secret = 'notification-signal-test-secret';
const room = `notification-signals:${tenant}:${user}`;
function request(overrides = {}, ttl = 300, signingSecret = secret) {
  const token = jwt.sign({ scope: 'notification-signals', tenantId: tenant, userId: user, sessionId, ...overrides }, signingSecret,
    { ...('exp' in overrides ? {} : { expiresIn: ttl }), algorithm: 'HS256', audience: 'notification-signals' });
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
  // Fixed identifiers, not randomUUID(): `%j` interpolates the case into the
  // test NAME, and the shard runner reconciles collected names against executed
  // ones. A value generated at module load differs between the collection pass
  // and the execution pass, so every run reported
  // "Collected/executed test count differs" / "Unexpected executed test" and
  // failed the shard. The assertion only needs identifiers that do NOT match the
  // signed token, which these do.
  const OTHER_TENANT = '00000000-0000-4000-8000-0000000000aa';
  const OTHER_USER = '00000000-0000-4000-8000-0000000000bb';
  it.each([{ tenantId: OTHER_TENANT }, { userId: OTHER_USER }, { sessionId: 'not-a-session' }, { scope: 'ticket' }])('rejects a mismatched token %j', overrides => {
    expect(() => validateDocumentRoomAccess(room, request(overrides))).toThrow();
  });
  it('rejects expired, oversized-lifetime and incorrectly signed tokens', () => {
    expect(() => validateDocumentRoomAccess(room, request({}, -120))).toThrow();
    expect(() => validateDocumentRoomAccess(room, request({}, 301))).toThrow();
    expect(() => validateDocumentRoomAccess(room, request({}, 300, 'wrong'))).toThrow();
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
    const access = { tenantId: tenant, userId: user, expiresAt: Date.now() + 5000, deadline: Date.now() + 65000 };
    expect(filter({ context: { notificationSignals: access } })).toBe(true);
    expect(filter({ context: { notificationSignals: { ...access, userId: randomUUID() } } })).toBe(false);
    expect(filter({ context: { notificationSignals: { ...access, deadline: Date.now() - 1 } } })).toBe(false);
    expect(filter({ context: {} })).toBe(false);
    expect(document.getMap).not.toHaveBeenCalled();
    await expect(extension.beforeHandleMessage({ documentName: room, context: { notificationSignals: { ...access, deadline: 0 } } })).rejects.toThrow('expired');
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
  describe('deadline after join (exp + 60s leeway)', () => {
    const connectAt = async (extension, ttl, exp?: number) => {
      const connection = { readOnly: false, close: vi.fn() };
      const claims = exp === undefined ? {} : { iat: exp - 300, exp };
      const context = await extension.onConnect({ documentName: room, request: request(claims, ttl), connection });
      return { context, connection };
    };
    it('keeps a token exp = now-55s usable: messages pass and the ring reaches that connection', async () => {
      const { extension, instance, broadcastStateless } = harness();
      await extension.onConfigure({ instance });
      const { context, connection } = await connectAt(extension, 0, Math.floor(Date.now() / 1000) - 55);
      await expect(extension.beforeHandleMessage({ documentName: room, context })).resolves.toBeUndefined();
      await extension.connected({ documentName: room, context, connectionInstance: connection });
      expect(connection.close).not.toHaveBeenCalled();
      await extension.handleMessage(JSON.stringify({ type: 'telephony.incoming_call', event: 'ringing', call: { callId: 'c1' } }), `test:internal-notifications:${tenant}:${user}`);
      const [, filter] = broadcastStateless.mock.calls[0];
      expect(filter({ context })).toBe(true);
      await extension.onDisconnect({ documentName: room, context });
    });
    it('closes the socket at exp + 60s and rejects messages after it', async () => {
      vi.useFakeTimers();
      try {
        const { extension } = harness();
        const { context, connection } = await connectAt(extension, 120);
        await extension.connected({ documentName: room, context, connectionInstance: connection });
        await vi.advanceTimersByTimeAsync(170_000);
        expect(connection.close).not.toHaveBeenCalled();
        await expect(extension.beforeHandleMessage({ documentName: room, context })).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(12_000);
        expect(connection.close).toHaveBeenCalledOnce();
        await expect(extension.beforeHandleMessage({ documentName: room, context })).rejects.toThrow('expired');
      } finally { vi.useRealTimers(); }
    });
    it('closes immediately when the deadline has already passed', async () => {
      const { extension } = harness();
      const { context, connection } = await connectAt(extension, 120);
      context.notificationSignals.deadline = Date.now() - 1;
      await extension.connected({ documentName: room, context, connectionInstance: connection });
      expect(connection.close).toHaveBeenCalledOnce();
    });
    it('clears the timer on disconnect so nothing closes a connection that is gone', async () => {
      vi.useFakeTimers();
      try {
        const { extension } = harness();
        const { context, connection } = await connectAt(extension, 120);
        await extension.connected({ documentName: room, context, connectionInstance: connection });
        await extension.onDisconnect({ documentName: room, context });
        await vi.advanceTimersByTimeAsync(300_000);
        expect(connection.close).not.toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });
  });
  describe('legacy notifications: rooms (rollout window)', () => {
    const legacyRoom = `notifications:${tenant}:${user}`;
    const legacyRequest = new Request('http://localhost/hocuspocus');
    function legacyHarness() {
      const subscribe = vi.fn(async () => {});
      const unsubscribe = vi.fn(async () => {});
      const extension: any = new NotificationExtension({ redisPrefix: 'test:', createClient: () => ({}) });
      const doc = new Y.Doc();
      extension.subscriber = { subscribe, unsubscribe };
      extension.instance = { documents: new Map([[legacyRoom, doc]]) };
      return { extension, subscribe, unsubscribe, doc };
    }
    beforeEach(() => { delete process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS; });

    it('refuses the room and never subscribes while the flag is unset', async () => {
      const { extension, subscribe } = legacyHarness();
      expect(() => validateDocumentRoomAccess(legacyRoom, legacyRequest)).toThrow('Legacy notification rooms');
      await expect(extension.onConnect({ documentName: legacyRoom, request: legacyRequest })).rejects.toThrow('Legacy notification rooms');
      expect(subscribe).not.toHaveBeenCalled();
    });

    it('admits the room only with the flag, still refusing malformed names and forged tokens', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      expect(validateDocumentRoomAccess(legacyRoom, legacyRequest)).toMatchObject({ status: 'ok', legacy: true, tenantId: tenant, userId: user });
      expect(() => validateDocumentRoomAccess('notifications:tenant-1:user-1', legacyRequest)).toThrow();
      expect(() => validateDocumentRoomAccess(`notifications:${tenant}`, legacyRequest)).toThrow();
      // A token that is presented must verify and match the room.
      expect(() => validateDocumentRoomAccess(legacyRoom, request({ userId: randomUUID() }))).toThrow();
      expect(() => validateDocumentRoomAccess(legacyRoom, request({}, 300, 'wrong'))).toThrow();
      expect(validateDocumentRoomAccess(legacyRoom, request())).toMatchObject({ legacy: true });
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'yes';
      expect(() => validateDocumentRoomAccess(legacyRoom, legacyRequest)).toThrow('Legacy notification rooms');
    });

    it('relays into the Yjs maps only for admitted legacy rooms, and unsubscribes with the last connection', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      const { extension, subscribe, unsubscribe, doc } = legacyHarness();
      await extension.onConnect({ documentName: legacyRoom, request: legacyRequest });
      await extension.onConnect({ documentName: legacyRoom, request: legacyRequest });
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledWith(`test:internal-notifications:${tenant}:${user}`, expect.any(Function));
      const deliver = (subscribe.mock.calls[0] as any)[1];
      await deliver(JSON.stringify({ type: 'notification.created', notification: { internal_notification_id: 'n-1' } }));
      expect(doc.getMap('unreadCount').get('count')).toBe(1);
      await extension.onDisconnect({ documentName: legacyRoom });
      expect(unsubscribe).not.toHaveBeenCalled();
      await extension.onDisconnect({ documentName: legacyRoom });
      expect(unsubscribe).toHaveBeenCalledOnce();
    });
  });
});
