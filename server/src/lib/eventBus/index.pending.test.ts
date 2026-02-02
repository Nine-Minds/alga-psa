import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

type FakeRedisClient = EventEmitter & {
  connect: () => Promise<void>;
  disconnect: () => void;
  quit: () => Promise<void>;
  xGroupCreate: () => Promise<void>;
  xReadGroup: (...args: any[]) => Promise<any>;
  xAck: (...args: any[]) => Promise<number>;
  xPending: (...args: any[]) => Promise<{ pending: number }>;
  xPendingRange: (...args: any[]) => Promise<any[]>;
  xClaim: (...args: any[]) => Promise<any>;
  sIsMember: (...args: any[]) => Promise<boolean>;
  sAdd: (...args: any[]) => Promise<number>;
  expire: (...args: any[]) => Promise<number>;
};

async function flushMicrotasks(limit: number = 50) {
  for (let i = 0; i < limit; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

describe('EventBus pending message recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('claims and processes stale pending messages (acks on success)', async () => {
    const messageId = '1-0';

    const tenantId = randomUUID();
    const eventType = 'UNKNOWN';
    const event = {
      id: randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      payload: { tenantId },
    };

    const handler = vi.fn(async () => undefined);
    let didAck = false;
    const processed = new Set<string>();

    vi.doMock('redis', () => {
      return {
        createClient: () => {
          const client = new EventEmitter() as FakeRedisClient;

          client.connect = vi.fn(async () => {
            client.emit('connect');
            client.emit('ready');
          });

          client.disconnect = vi.fn(() => {
            client.emit('end');
          });

          client.quit = vi.fn(async () => {
            client.emit('end');
          });

          client.xGroupCreate = vi.fn(async () => undefined);
          client.xReadGroup = vi.fn(async () => null);
          client.xAck = vi.fn(async () => {
            didAck = true;
            return 1;
          });

          client.xPending = vi.fn()
            .mockResolvedValueOnce({ pending: 1 })
            .mockResolvedValue({ pending: 0 });
          client.xPendingRange = vi.fn()
            .mockResolvedValueOnce([
              {
                id: messageId,
                consumer: 'consumer-old',
                millisecondsSinceLastDelivery: 30001,
                deliveriesCounter: 1,
              },
            ])
            .mockResolvedValue([]);
          client.xClaim = vi.fn()
            .mockResolvedValueOnce([
              { id: messageId, message: { event: JSON.stringify(event), channel: 'global' } },
            ])
            .mockResolvedValue([]);

          client.sIsMember = vi.fn(async (_key: string, member: string) => processed.has(member));
          client.sAdd = vi.fn(async (_key: string, member: string) => {
            processed.add(member);
            return 1;
          });
          client.expire = vi.fn(async () => 1);

          return client;
        },
      };
    });

    const { getEventBus } = await import('./index');

    const eventBus = getEventBus();
    await eventBus.subscribe(eventType as any, handler);

    // The event processing loop may have started before the handler was registered and scheduled
    // a retry via setTimeout. Advance timers to let that retry run.
    await vi.advanceTimersByTimeAsync(1100);
    for (let i = 0; i < 50 && !didAck; i++) {
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks(10);
    }

    expect(handler).toHaveBeenCalledTimes(1);
    expect(didAck).toBe(true);

    await eventBus.close();
  });
});
