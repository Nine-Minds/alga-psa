import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

type FakeRedisClient = EventEmitter & {
  connect: () => Promise<void>;
  disconnect: () => void;
  quit: () => Promise<void>;
  xGroupCreate: () => Promise<void>;
  xReadGroup: (...args: any[]) => Promise<any>;
  xAdd: (...args: any[]) => Promise<string>;
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

function mockModules(opts: {
  pendingRounds: Array<{
    deliveriesCounter: number;
  }>;
  message: { id: string; event: Record<string, unknown> };
  onAck: () => void;
  onDeadLetter: (stream: string, fields: Record<string, string>) => void;
  processed: Set<string>;
}) {
  vi.doMock('@alga-psa/core/logger', () => ({
    default: {
      info: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      error: () => undefined,
    },
  }));

  vi.doMock('redis', () => ({
    createClient: () => {
      const client = new EventEmitter() as FakeRedisClient;
      let round = 0;

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
      client.xAdd = vi.fn(async (stream: string, _id: string, fields: Record<string, string>) => {
        opts.onDeadLetter(stream, fields);
        return '1-1';
      });
      client.xAck = vi.fn(async () => {
        opts.onAck();
        return 1;
      });

      client.xPending = vi.fn(async () =>
        round < opts.pendingRounds.length ? { pending: 1 } : { pending: 0 }
      );
      client.xPendingRange = vi.fn(async () => {
        if (round >= opts.pendingRounds.length) {
          return [];
        }
        const entry = opts.pendingRounds[round];
        round += 1;
        return [
          {
            id: opts.message.id,
            consumer: 'consumer-old',
            millisecondsSinceLastDelivery: 30001,
            deliveriesCounter: entry.deliveriesCounter,
          },
        ];
      });
      client.xClaim = vi.fn(async () => [
        {
          id: opts.message.id,
          message: { event: JSON.stringify(opts.message.event), channel: 'global' },
        },
      ]);

      client.sIsMember = vi.fn(async (_key: string, member: string) => opts.processed.has(member));
      client.sAdd = vi.fn(async (_key: string, member: string) => {
        opts.processed.add(member);
        return 1;
      });
      client.expire = vi.fn(async () => 1);

      return client;
    },
  }));
}

describe('EventBus poison resistance', () => {
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

  it('dead-letters and acks a message that exceeded max deliveries without running handlers', async () => {
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
    const deadLetters: Array<{ stream: string; fields: Record<string, string> }> = [];

    mockModules({
      // deliveriesCounter beyond the default maxDeliveries (10)
      pendingRounds: [{ deliveriesCounter: 11 }],
      message: { id: '1-0', event },
      onAck: () => {
        didAck = true;
      },
      onDeadLetter: (stream, fields) => {
        deadLetters.push({ stream, fields });
      },
      processed: new Set<string>(),
    });

    const { getEventBus } = await import('./index');
    const eventBus = getEventBus();
    await eventBus.subscribe(eventType as any, handler, { subscriberId: 'victim' });

    await vi.advanceTimersByTimeAsync(1100);
    for (let i = 0; i < 50 && !didAck; i++) {
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks(10);
    }

    expect(didAck).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].stream).toMatch(/:dead-letter$/);
    expect(deadLetters[0].fields.sourceMessageId).toBe('1-0');
    expect(deadLetters[0].fields.deliveries).toBe('11');

    await eventBus.close();
  });

  it('does not re-invoke a sibling handler that already succeeded when another handler fails', async () => {
    const tenantId = randomUUID();
    const eventType = 'UNKNOWN';
    const event = {
      id: randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      payload: { tenantId },
    };

    const succeeding = vi.fn(async () => undefined);
    let failures = 0;
    const failingOnce = vi.fn(async () => {
      failures += 1;
      if (failures === 1) {
        throw new Error('transient failure');
      }
    });

    let didAck = false;

    mockModules({
      // two delivery rounds: first fails one handler, second succeeds
      pendingRounds: [{ deliveriesCounter: 1 }, { deliveriesCounter: 2 }],
      message: { id: '2-0', event },
      onAck: () => {
        didAck = true;
      },
      onDeadLetter: () => undefined,
      processed: new Set<string>(),
    });

    const { getEventBus } = await import('./index');
    const eventBus = getEventBus();
    await eventBus.subscribe(eventType as any, succeeding, { subscriberId: 'sibling-ok' });
    await eventBus.subscribe(eventType as any, failingOnce, { subscriberId: 'sibling-flaky' });

    await vi.advanceTimersByTimeAsync(1100);
    for (let i = 0; i < 100 && !didAck; i++) {
      // eslint-disable-next-line no-await-in-loop
      await flushMicrotasks(10);
    }

    expect(didAck).toBe(true);
    // The succeeded sibling ran exactly once; only the failed handler retried.
    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(failingOnce).toHaveBeenCalledTimes(2);

    await eventBus.close();
  });
});
