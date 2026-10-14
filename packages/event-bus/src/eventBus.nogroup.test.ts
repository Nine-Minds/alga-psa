import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

type FakeRedisClient = EventEmitter & Record<string, any>;

const NOGROUP_MESSAGE = (stream: string) =>
  `NOGROUP No such key '${stream}' or consumer group 'event-processors' in XREADGROUP with GROUP option`;

async function flush(limit = 50) {
  for (let i = 0; i < limit; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

interface Harness {
  client: FakeRedisClient;
  logger: { info: any; warn: any; debug: any; error: any };
}

/** Installs mocks for `redis` and the logger and returns the single fake client. */
function installMocks(configure: (client: FakeRedisClient) => void): Harness {
  const harness = {} as Harness;
  harness.logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  vi.doMock('@alga-psa/core/logger', () => ({ default: harness.logger }));
  vi.doMock('redis', () => ({
    createClient: () => {
      const client = new EventEmitter() as FakeRedisClient;
      client.executeIsolated = async (callback: any) => callback(client);
      client.connect = vi.fn(async () => {
        client.emit('connect');
        client.emit('ready');
      });
      client.disconnect = vi.fn(() => client.emit('end'));
      client.quit = vi.fn(async () => client.emit('end'));
      client.xGroupCreate = vi.fn(async () => undefined);
      client.xReadGroup = vi.fn(async () => null);
      client.xAck = vi.fn(async () => 1);
      client.xPending = vi.fn(async () => ({ pending: 0 }));
      client.xPendingRange = vi.fn(async () => []);
      client.xClaim = vi.fn(async () => []);
      client.sIsMember = vi.fn(async () => false);
      client.sAdd = vi.fn(async () => 1);
      client.expire = vi.fn(async () => 1);
      configure(client);
      harness.client = client;
      return client;
    },
  }));
  return harness;
}

describe('EventBus NOGROUP self-heal', () => {
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

  it('T1: recreates every subscribed group after NOGROUP and delivers the event', async () => {
    const eventType = 'CUSTOM_EVENT';
    const otherType = 'CUSTOM_EVENT_OTHER';
    const event = {
      id: randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      payload: { tenantId: randomUUID() },
    };
    let reads = 0;
    let createsAtThrow = -1;
    const processed = new Set<string>();

    const h = installMocks((client) => {
      client.xReadGroup = vi.fn(async (_group: string, _consumer: string, streams: Array<{ key: string }>) => {
        reads += 1;
        if (reads === 1) {
          createsAtThrow = client.xGroupCreate.mock.calls.length;
          throw new Error(NOGROUP_MESSAGE(streams[0].key));
        }
        if (reads === 2) {
          return [{ name: streams[0].key, messages: [{ id: '1-0', message: { event: JSON.stringify(event), channel: 'global' } }] }];
        }
        return null;
      });
      client.sIsMember = vi.fn(async (_k: string, member: string) => processed.has(member));
      client.sAdd = vi.fn(async (_k: string, member: string) => {
        processed.add(member);
        return 1;
      });
    });

    const { getEventBus } = await import('./index');
    const handler = vi.fn(async () => undefined);
    const bus = getEventBus();
    await bus.subscribe(eventType as any, handler);
    await bus.subscribe(otherType as any, vi.fn(async () => undefined));

    await vi.advanceTimersByTimeAsync(1100);
    for (let i = 0; i < 50 && handler.mock.calls.length === 0; i++) {
      // eslint-disable-next-line no-await-in-loop
      await flush(10);
    }

    const { client } = h;
    expect(createsAtThrow).toBeGreaterThanOrEqual(0);
    const readStreams = client.xReadGroup.mock.calls[0][2].map((s: { key: string }) => s.key);
    const afterThrow = client.xGroupCreate.mock.calls.slice(createsAtThrow);
    for (const stream of readStreams) {
      const call = afterThrow.find((c: any[]) => c[0] === stream);
      expect(call, `group recreated for ${stream}`).toBeDefined();
      expect(call![2]).toBe('0');
      expect(call![3]).toEqual({ MKSTREAM: true });
    }
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.xAck).toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();

    await bus.close();
  });

  it('T2: persistent NOGROUP does not spam errors or hot-loop', async () => {
    const h = installMocks((client) => {
      client.xReadGroup = vi.fn(async (_g: string, _c: string, streams: Array<{ key: string }>) => {
        throw new Error(NOGROUP_MESSAGE(streams[0].key));
      });
    });

    const { getEventBus } = await import('./index');
    const bus = getEventBus();
    await bus.subscribe('CUSTOM_EVENT' as any, vi.fn(async () => undefined));

    await vi.advanceTimersByTimeAsync(6000);
    const readsAfter6s = h.client.xReadGroup.mock.calls.length;

    expect(readsAfter6s).toBeGreaterThanOrEqual(5);
    // 1 immediate retry + ~1 per second: a hot loop would be orders of magnitude higher.
    expect(readsAfter6s).toBeLessThanOrEqual(12);

    const errorLoopCalls = h.logger.error.mock.calls.filter(
      (c: any[]) => c[0] === '[EventBus] Error in event processing loop:'
    );
    expect(errorLoopCalls).toEqual([]);

    const recreateWarns = h.logger.warn.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('consumer group missing')
    );
    // One warn per stream recovery (each loop pass recreates once), never more than reads.
    expect(recreateWarns.length).toBeGreaterThan(0);
    expect(recreateWarns.length).toBeLessThanOrEqual(readsAfter6s);
    const streamWarns = h.logger.warn.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('NOGROUP in event processing loop')
    );
    expect(streamWarns).toHaveLength(1);

    await bus.close();
  });

  it('T3: NOGROUP from the claim path warns (not errors) and the group is recreated', async () => {
    let pendingCalls = 0;
    let createsAtThrow = -1;
    const h = installMocks((client) => {
      client.xPending = vi.fn(async (stream: string) => {
        pendingCalls += 1;
        if (pendingCalls === 1) {
          createsAtThrow = client.xGroupCreate.mock.calls.length;
          throw new Error(NOGROUP_MESSAGE(stream));
        }
        return { pending: 0 };
      });
    });

    const { getEventBus } = await import('./index');
    const bus = getEventBus();
    await bus.subscribe('CUSTOM_EVENT' as any, vi.fn(async () => undefined));

    await vi.advanceTimersByTimeAsync(1100);
    await flush(20);

    expect(createsAtThrow).toBeGreaterThanOrEqual(0);
    expect(h.client.xGroupCreate.mock.calls.length).toBeGreaterThan(createsAtThrow);
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(
      h.logger.warn.mock.calls.some((c: any[]) => String(c[0]).includes('NOGROUP while claiming'))
    ).toBe(true);

    await bus.close();
  });
});
