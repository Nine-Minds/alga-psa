import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import jwt from 'jsonwebtoken';

vi.mock('redis', () => ({ createClient: vi.fn() }));

// The bridge lives outside any package; exercised here because the hook that
// consumes the signal is this package's.
import { NotificationExtension } from '../../../../hocuspocus/NotificationExtension.js';

const tenant = 'tenant-1';
const user = 'user-1';
const room = `notification-signals:${tenant}:${user}`;
const call = { callId: 'call-1', participantId: 'p-1', dn: '101', contact: null };

function harness() {
  const broadcastStateless = vi.fn();
  // Any Yjs access from the relay is a security regression, so make it loud.
  const getMap = vi.fn(() => { throw new Error('Notification and call payloads must never enter Yjs'); });
  // Typed loosely: the Hocuspocus instance is replaced by a capture stub.
  const extension: any = new NotificationExtension({ redisPrefix: 'test:', createClient: () => ({}) });
  extension.instance = { documents: new Map([[room, { broadcastStateless, getMap }]]) };
  return {
    extension,
    broadcastStateless,
    getMap,
    deliver: (message: unknown) =>
      extension.handleMessage(JSON.stringify(message), `test:internal-notifications:${tenant}:${user}`),
    lastSignal: () => JSON.parse(broadcastStateless.mock.calls.at(-1)![0]),
    lastFilter: () => broadcastStateless.mock.calls.at(-1)![1],
  };
}

describe('NotificationExtension telephony.incoming_call relay', () => {
  it('T053: relays the ring as a stateless { event, call, receivedAt } signal', async () => {
    const { deliver, lastSignal } = harness();

    await deliver({ type: 'telephony.incoming_call', event: 'ringing', call, timestamp: '2026-09-15T10:00:00.000Z' });
    expect(lastSignal()).toEqual({
      type: 'telephony.incoming_call',
      entry: { event: 'ringing', call, receivedAt: '2026-09-15T10:00:00.000Z' },
    });

    await deliver({ type: 'telephony.incoming_call', event: 'ended', call });
    const signal = lastSignal();
    expect(signal.entry.event).toBe('ended');
    expect(typeof signal.entry.receivedAt).toBe('string');
  });

  it('T054: never writes the call — or any notification — into a Yjs document', async () => {
    const { deliver, getMap } = harness();

    await deliver({ type: 'telephony.incoming_call', event: 'ringing', call });
    await deliver({ type: 'notification.created', notification: { message: 'Private canary' } });
    await deliver({ type: 'notifications.unread_count', unreadCount: 99 });

    // getMap throws; that it was never called is the invariant under test.
    expect(getMap).not.toHaveBeenCalled();
  });

  it('applies the same tenant/user/expiry connection filter as notifications.changed', async () => {
    const { deliver, lastFilter } = harness();
    await deliver({ type: 'telephony.incoming_call', event: 'ringing', call });
    const filter = lastFilter();
    const access = { tenantId: tenant, userId: user, expiresAt: Date.now() + 5000, deadline: Date.now() + 65000 };

    expect(filter({ context: { notificationSignals: access } })).toBe(true);
    expect(filter({ context: { notificationSignals: { ...access, tenantId: 'other-tenant' } } })).toBe(false);
    expect(filter({ context: { notificationSignals: { ...access, userId: 'other-user' } } })).toBe(false);
    expect(filter({ context: { notificationSignals: { ...access, deadline: Date.now() - 1 } } })).toBe(false);
    expect(filter({ context: {} })).toBe(false);
  });

  it('relays nothing for another user’s channel or a malformed ring', async () => {
    const { extension, broadcastStateless, deliver } = harness();

    await extension.handleMessage(
      JSON.stringify({ type: 'telephony.incoming_call', event: 'ringing', call }),
      `test:internal-notifications:${tenant}:someone-else`,
    );
    await deliver({ type: 'telephony.incoming_call', event: 'ringing' });
    await deliver({ type: 'telephony.incoming_call', call });

    expect(broadcastStateless).not.toHaveBeenCalled();
  });

  it('leaves inbox events as the constant content-free wake-up', async () => {
    const { deliver, lastSignal } = harness();
    await deliver({ type: 'notification.created', notification: { message: 'Private canary' }, unreadCount: 99 });
    expect(lastSignal()).toEqual({ type: 'notifications.changed' });
  });
});

describe('NotificationExtension legacy notifications: room relay (rollout window only)', () => {
  const legacyRoom = 'notifications:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';
  const channel = 'test:internal-notifications:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS = 'true';
    process.env.HOCUSPOCUS_JWT_SECRET = 'legacy-relay-secret';
  });
  afterEach(() => { delete process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS; });

  // The owner's own token: legacy rooms admit nobody else, even with the window open.
  const ownerRequest = () => {
    const token = jwt.sign({ scope: 'notification-signals', tenantId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222', sessionId: '33333333-3333-4333-8333-333333333333' },
    'legacy-relay-secret', { expiresIn: 300, algorithm: 'HS256', audience: 'notification-signals' });
    return new Request(`http://localhost/hocuspocus?token=${token}`);
  };

  async function connectRoom() {
    const extension: any = new NotificationExtension({ redisPrefix: 'test:', createClient: () => ({}) });
    const doc = new Y.Doc();
    let handler: ((message: string) => void) | null = null;
    extension.instance = { documents: new Map([[legacyRoom, doc]]) };
    extension.subscriber = {
      subscribe: vi.fn(async (_channel: string, callback: (message: string) => void) => { handler = callback; }),
      unsubscribe: vi.fn(),
    };
    await extension.onConnect({ documentName: legacyRoom, request: ownerRequest() });
    expect(extension.subscriber.subscribe).toHaveBeenCalledWith(channel, expect.any(Function));
    return { doc, deliver: (message: unknown) => handler!(JSON.stringify(message)) };
  }

  it('T053-legacy: writes the ring into the incomingCall map as { event, call, receivedAt }', async () => {
    const { doc, deliver } = await connectRoom();
    await deliver({ type: 'telephony.incoming_call', event: 'ringing', call, timestamp: '2026-09-15T10:00:00.000Z' });
    expect(doc.getMap('incomingCall').get('data')).toEqual({ event: 'ringing', call, receivedAt: '2026-09-15T10:00:00.000Z' });
  });

  it('T054-legacy: leaves the notifications and unreadCount maps untouched by a ring', async () => {
    const { doc, deliver } = await connectRoom();
    doc.getMap('notifications').set('data', [{ internal_notification_id: 'n-1' }]);
    doc.getMap('unreadCount').set('count', 4);
    await deliver({ type: 'telephony.incoming_call', event: 'ringing', call });
    expect(doc.getMap('notifications').get('data')).toEqual([{ internal_notification_id: 'n-1' }]);
    expect(doc.getMap('unreadCount').get('count')).toBe(4);
  });

  it('refuses to subscribe when the flag is unset', async () => {
    delete process.env.HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS;
    const extension: any = new NotificationExtension({ redisPrefix: 'test:', createClient: () => ({}) });
    extension.subscriber = { subscribe: vi.fn(), unsubscribe: vi.fn() };
    await expect(extension.onConnect({ documentName: legacyRoom, request: ownerRequest() })).rejects.toThrow('Legacy notification rooms');
    expect(extension.subscriber.subscribe).not.toHaveBeenCalled();
  });
});
