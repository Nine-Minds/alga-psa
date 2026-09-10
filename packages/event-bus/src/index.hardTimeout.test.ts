import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Captured before vi.useFakeTimers() replaces the globals, so these keep
// driving the real event loop and the real clock while fake timers are active.
const realSetTimeout = globalThis.setTimeout;
const realDateNow = Date.now.bind(Date);

type FakeRedisClient = EventEmitter & {
  isOpen: boolean;
  executeIsolated: <T>(callback: (reader: FakeRedisClient) => Promise<T>) => Promise<T>;
  connect: () => Promise<void>;
  disconnect: () => void;
  quit: () => Promise<void>;
  xGroupCreate: () => Promise<void>;
  xReadGroup: (...args: any[]) => Promise<any>;
  xAck: () => Promise<number>;
  xPending: () => Promise<{ pending: number }>;
  xPendingRange: () => Promise<any[]>;
  xClaim: () => Promise<any>;
  sIsMember: () => Promise<boolean>;
  sAdd: () => Promise<number>;
  expire: () => Promise<number>;
};

describe('EventBus Redis consumer hard-timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('resets the Redis client if xReadGroup hangs beyond the hard timeout', { timeout: 45_000 }, async () => {
    const createdClients: FakeRedisClient[] = [];
    const leasedReaders: FakeRedisClient[] = [];

    vi.doMock('redis', () => {
      return {
        createClient: () => {
          const client = new EventEmitter() as FakeRedisClient;
          client.executeIsolated = async callback => {
            let rejectRead: ((error: Error) => void) | undefined;
            const reader = new EventEmitter() as FakeRedisClient;
            reader.isOpen = true;
            reader.xReadGroup = vi.fn(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
            reader.disconnect = vi.fn(() => {
              reader.isOpen = false;
              rejectRead?.(new Error('Synthetic isolated reader disconnected'));
            });
            leasedReaders.push(reader);
            return callback(reader);
          };

          client.connect = vi.fn(async () => {
            client.emit('connect');
            client.emit('ready');
          });

          client.disconnect = vi.fn(() => {
            expect(leasedReaders.every(reader => !reader.isOpen)).toBe(true);
            client.emit('end');
          });

          client.quit = vi.fn(async () => {
            client.emit('end');
          });

          client.xGroupCreate = vi.fn(async () => undefined);
          client.xAck = vi.fn(async () => 1);
          client.xPending = vi.fn(async () => ({ pending: 0 }));
          client.xPendingRange = vi.fn(async () => []);
          client.xClaim = vi.fn(async () => undefined);
          client.sIsMember = vi.fn(async () => false);
          client.sAdd = vi.fn(async () => 1);
          client.expire = vi.fn(async () => 1);

          // Reads must use the leased reader, never the publishing connection.
          client.xReadGroup = vi.fn(async () => { throw new Error('Blocking read used publishing connection'); });

          createdClients.push(client);
          return client;
        }
      };
    });

    const { getEventBus } = await import('./index');
    const { EventSchemas } = await import('./schemas/eventBusSchema');

    const eventBus = getEventBus();
    const eventType = Object.keys(EventSchemas)[0] as any;
    await eventBus.subscribe(eventType, async () => undefined);

    // Default hard timeout: max(blockingTimeout + 10000, 15000) => 15000ms (blockingTimeout=5000).
    // Add 1000ms to allow the loop to detect the first subscription before calling xReadGroup.
    await vi.advanceTimersByTimeAsync(16000);

    // After the hard timeout the bus resets the client and reschedules the
    // consumer loop via setTimeout(..., 0); that next iteration is what
    // re-creates the Redis client. Recreation is not driven purely by fake
    // timers: createRedisClient() awaits getSecret(), whose filesystem lookups
    // run on the libuv threadpool in real time. Alternate fake-time advances
    // (to fire the loop's scheduled timers) with short real sleeps (to let
    // pending I/O complete), bounded by a real-clock deadline rather than a
    // fixed iteration budget so a loaded machine cannot starve the wait.
    const waitDeadline = realDateNow() + 30_000;
    while (createdClients.length < 2 && realDateNow() < waitDeadline) {
      await vi.advanceTimersByTimeAsync(1000);
      await new Promise((resolve) => realSetTimeout(resolve, 5));
    }

    expect(createdClients.length).toBeGreaterThanOrEqual(2);
    expect(createdClients[0].disconnect).toHaveBeenCalled();
    expect(leasedReaders[0].disconnect).toHaveBeenCalledOnce();
    expect(leasedReaders[0].isOpen).toBe(false);

    await eventBus.close();
    expect(leasedReaders.every(reader => !reader.isOpen)).toBe(true);
  });
});
