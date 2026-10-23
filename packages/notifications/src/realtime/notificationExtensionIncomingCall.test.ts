import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('redis', () => ({ createClient: vi.fn() }));

// The bridge lives outside any package; exercised here because the hook that
// consumes the `incomingCall` map is this package's.
import { NotificationExtension } from '../../../../hocuspocus/NotificationExtension.js';

type Handler = (message: string) => Promise<void>;

async function connectRoom() {
  // Typed loosely: the Redis subscriber is replaced by a capture stub.
  const extension: any = new NotificationExtension({ redisPrefix: 'test:' });
  const doc = new Y.Doc();
  const roomName = 'notifications:tenant-1:user-1';
  let handler: Handler | null = null;
  extension.instance = { documents: new Map([[roomName, doc]]) };
  extension.subscriber = {
    subscribe: vi.fn(async (_channel: string, callback: Handler) => {
      handler = callback;
    }),
    unsubscribe: vi.fn(),
  };
  await extension.onConnect({ documentName: roomName });
  expect(extension.subscriber.subscribe).toHaveBeenCalledWith('test:internal-notifications:tenant-1:user-1', expect.any(Function));
  return { doc, deliver: (message: unknown) => handler!(JSON.stringify(message)) };
}

describe('NotificationExtension telephony.incoming_call relay', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('T053: writes the message into the incomingCall map as { event, call, receivedAt }', async () => {
    const { doc, deliver } = await connectRoom();
    const call = { callId: 'call-1', participantId: 'p-1', dn: '101', contact: null };

    await deliver({ type: 'telephony.incoming_call', event: 'ringing', call, timestamp: '2026-09-15T10:00:00.000Z' });

    expect(doc.getMap('incomingCall').get('data')).toEqual({
      event: 'ringing',
      call,
      receivedAt: '2026-09-15T10:00:00.000Z',
    });

    await deliver({ type: 'telephony.incoming_call', event: 'ended', call: { callId: 'call-1', participantId: 'p-1', dn: '101' } });
    const entry = doc.getMap('incomingCall').get('data') as { event: string; receivedAt: string };
    expect(entry.event).toBe('ended');
    expect(typeof entry.receivedAt).toBe('string');
  });

  it('T054: leaves the notifications and unreadCount maps untouched', async () => {
    const { doc, deliver } = await connectRoom();
    doc.getMap('notifications').set('data', [{ internal_notification_id: 'n-1' }]);
    doc.getMap('unreadCount').set('count', 4);

    await deliver({ type: 'telephony.incoming_call', event: 'ringing', call: { callId: 'call-1', participantId: 'p-1', dn: '101' } });

    expect(doc.getMap('notifications').get('data')).toEqual([{ internal_notification_id: 'n-1' }]);
    expect(doc.getMap('unreadCount').get('count')).toBe(4);
  });
});
