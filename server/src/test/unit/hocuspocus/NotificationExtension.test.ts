import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    // Same user id, other tenant: the tenant half of the binding must hold on its own.
    expect(filter({ context: { notificationSignals: { ...access, tenantId: randomUUID() } } })).toBe(false);
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
    const liveTokenUrl = 'http://web.internal/api/notifications/live-token';
    const sign = (overrides = {}) => jwt.sign({ scope: 'notification-signals', tenantId: tenant, userId: user, sessionId, ...overrides }, secret,
      { expiresIn: 300, algorithm: 'HS256', audience: 'notification-signals' });
    // A pre-signal bundle sends no token; its upgrade request carries the session cookie.
    const browser = (cookie: string | null = 'authjs.session-token=owner') =>
      new Request('http://localhost/hocuspocus', cookie ? { headers: { cookie } } : undefined);
    const webAnswers = (body: unknown, status = 200) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    function legacyHarness() {
      const subscribe = vi.fn(async () => {});
      const unsubscribe = vi.fn(async () => {});
      const extension: any = new NotificationExtension({ redisPrefix: 'test:', createClient: () => ({}) });
      const doc = new Y.Doc();
      extension.subscriber = { subscribe, unsubscribe };
      extension.instance = { documents: new Map([[legacyRoom, doc]]) };
      return { extension, subscribe, unsubscribe, doc };
    }
    beforeEach(() => {
      delete process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS;
      process.env.NOTIFICATION_LIVE_TOKEN_URL = liveTokenUrl;
    });
    afterEach(() => {
      delete process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS;
      delete process.env.NOTIFICATION_LIVE_TOKEN_URL;
      vi.unstubAllGlobals();
    });

    it('refuses the room, never asks the web and never subscribes while the flag is unset', async () => {
      const fetch = webAnswers({ token: sign() }); vi.stubGlobal('fetch', fetch);
      const { extension, subscribe } = legacyHarness();
      await expect(validateDocumentRoomAccess(legacyRoom, browser())).rejects.toThrow('Legacy notification rooms');
      await expect(extension.onConnect({ documentName: legacyRoom, request: browser() })).rejects.toThrow('Legacy notification rooms');
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'yes';
      await expect(validateDocumentRoomAccess(legacyRoom, browser())).rejects.toThrow('Legacy notification rooms');
      expect(subscribe).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('with the flag open, admits only the owner proven by their own session cookie', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      const fetch = webAnswers({ token: sign() }); vi.stubGlobal('fetch', fetch);
      const { extension } = legacyHarness();
      const connection = { readOnly: false };
      const context = await extension.onConnect({ documentName: legacyRoom, request: browser(), connection });
      expect(connection.readOnly).toBe(true);
      expect(context.notificationSignals).toMatchObject({ legacy: true, tenantId: tenant, userId: user, sessionId });
      expect(context.notificationSignals.deadline).toBe(context.notificationSignals.expiresAt + 60_000);
      // The cookie, and nothing else from the socket, is what the web resolves.
      expect(fetch).toHaveBeenCalledWith(liveTokenUrl, expect.objectContaining({
        headers: expect.objectContaining({ cookie: 'authjs.session-token=owner' }), redirect: 'manual',
      }));
    });

    it('refuses a tokenless join with no session, a refused session, an unreachable web or no exchange URL', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      vi.stubGlobal('fetch', webAnswers({ token: sign() }));
      await expect(validateDocumentRoomAccess(legacyRoom, browser(null))).rejects.toThrow('missing session');
      vi.stubGlobal('fetch', webAnswers({ error: 'Unauthorized' }, 401));
      await expect(validateDocumentRoomAccess(legacyRoom, browser())).rejects.toThrow('session refused (401)');
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
      await expect(validateDocumentRoomAccess(legacyRoom, browser())).rejects.toThrow('session check unavailable');
      vi.stubGlobal('fetch', webAnswers({ nope: true }));
      await expect(validateDocumentRoomAccess(legacyRoom, browser())).rejects.toThrow('invalid session response');
      delete process.env.NOTIFICATION_LIVE_TOKEN_URL;
      await expect(validateDocumentRoomAccess(legacyRoom, browser())).rejects.toThrow('NOTIFICATION_LIVE_TOKEN_URL');
    });

    // Fixed ids: test names must be stable between collection and execution.
    it.each([
      ['another user', { userId: '00000000-0000-4000-8000-0000000000bb' }],
      ['the same user id in another tenant', { tenantId: '00000000-0000-4000-8000-0000000000aa' }],
    ])('refuses a forged join whose session belongs to %s', async (_label, claims) => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      vi.stubGlobal('fetch', webAnswers({ token: sign(claims) }));
      const { extension, subscribe } = legacyHarness();
      await expect(validateDocumentRoomAccess(legacyRoom, browser())).rejects.toThrow('scope mismatch');
      await expect(extension.onConnect({ documentName: legacyRoom, request: browser() })).rejects.toThrow('scope mismatch');
      expect(subscribe).not.toHaveBeenCalled();
    });

    it('verifies a presented token without asking the web, and refuses malformed rooms', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      const fetch = webAnswers({ token: sign() }); vi.stubGlobal('fetch', fetch);
      await expect(validateDocumentRoomAccess(legacyRoom, request())).resolves.toMatchObject({ legacy: true });
      await expect(validateDocumentRoomAccess(legacyRoom, request({ userId: randomUUID() }))).rejects.toThrow('scope mismatch');
      await expect(validateDocumentRoomAccess(legacyRoom, request({}, 300, 'wrong'))).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      await expect(validateDocumentRoomAccess('notifications:tenant-1:user-1', browser())).rejects.toThrow('Invalid legacy notification room');
      await expect(validateDocumentRoomAccess(`notifications:${tenant}`, browser())).rejects.toThrow('Invalid legacy notification room');
    });

    it('shares one session check between the gate and the extension, but never across rooms on one socket', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      const fetch = webAnswers({ token: sign() }); vi.stubGlobal('fetch', fetch);
      const { extension } = legacyHarness();
      const socket = browser();
      await validateDocumentRoomAccess(legacyRoom, socket);
      await extension.onConnect({ documentName: legacyRoom, request: socket });
      expect(fetch).toHaveBeenCalledTimes(1);
      // A second document multiplexed on the same socket is judged on its own.
      await expect(validateDocumentRoomAccess(`notifications:${tenant}:${randomUUID()}`, socket)).rejects.toThrow('scope mismatch');
    });

    it('closes a legacy socket at its deadline so it re-proves the session on reconnect', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      vi.useFakeTimers();
      try {
        vi.stubGlobal('fetch', webAnswers({ token: sign() }));
        const { extension } = legacyHarness();
        const connection = { readOnly: false, close: vi.fn() };
        const context = await extension.onConnect({ documentName: legacyRoom, request: browser(), connection });
        await extension.connected({ documentName: legacyRoom, context, connectionInstance: connection });
        await vi.advanceTimersByTimeAsync(359_000);
        expect(connection.close).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(connection.close).toHaveBeenCalledOnce();
        await expect(extension.beforeHandleMessage({ documentName: legacyRoom, context })).rejects.toThrow('expired');
      } finally { vi.useRealTimers(); }
    });

    it('relays into the Yjs maps only for admitted legacy rooms, and unsubscribes with the last connection', async () => {
      process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
      vi.stubGlobal('fetch', webAnswers({ token: sign() }));
      const { extension, subscribe, unsubscribe, doc } = legacyHarness();
      await extension.onConnect({ documentName: legacyRoom, request: browser() });
      await extension.onConnect({ documentName: legacyRoom, request: browser() });
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
