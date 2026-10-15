import { describe, expect, it, vi } from 'vitest';

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
    const access = { tenantId: tenant, userId: user, expiresAt: Date.now() + 5000 };

    expect(filter({ context: { notificationSignals: access } })).toBe(true);
    expect(filter({ context: { notificationSignals: { ...access, tenantId: 'other-tenant' } } })).toBe(false);
    expect(filter({ context: { notificationSignals: { ...access, userId: 'other-user' } } })).toBe(false);
    expect(filter({ context: { notificationSignals: { ...access, expiresAt: Date.now() - 1 } } })).toBe(false);
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
