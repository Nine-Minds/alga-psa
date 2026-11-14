import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { EVENT_BUS_REGISTRY_KEY } from '../eventBusRegistry';
import { discardRegisteredEventBus, useIsolatedEventBusModules } from './isolatedEventBusModules';

type Registry = { [EVENT_BUS_REGISTRY_KEY]?: { close(): Promise<void> } };
const registry = globalThis as typeof globalThis & Registry;

/** Mocks `redis` with a client factory that records which test created it. */
function mockRedisFor(owner: string, createdBy: string[]) {
  vi.doMock('@alga-psa/core/logger', () => ({
    default: { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined },
  }));
  vi.doMock('redis', () => ({
    createClient: () => {
      createdBy.push(owner);
      const client = new EventEmitter() as EventEmitter & Record<string, any>;
      client.isOpen = true;
      client.executeIsolated = async (callback: any) => callback(client);
      client.connect = vi.fn(async () => {
        client.emit('connect');
        client.emit('ready');
      });
      client.disconnect = vi.fn(async () => undefined);
      client.quit = vi.fn(async () => undefined);
      client.xGroupCreate = vi.fn(async () => undefined);
      // Never resolves: the consumer loop parks here, as a real blocking read does.
      client.xReadGroup = vi.fn(() => new Promise(() => undefined));
      client.xPending = vi.fn(async () => ({ pending: 0 }));
      client.xPendingRange = vi.fn(async () => []);
      return client;
    },
  }));
}

describe('useIsolatedEventBusModules', () => {
  useIsolatedEventBusModules();

  const createdBy: string[] = [];

  it('lets a test end without closing its bus (as a timed-out test does)', async () => {
    mockRedisFor('first', createdBy);
    const { getEventBus } = await import('../index');
    await getEventBus().subscribe('CUSTOM_EVENT' as any, vi.fn(async () => undefined));

    expect(createdBy).toContain('first');
    expect(registry[EVENT_BUS_REGISTRY_KEY]).toBeDefined();
    // Deliberately no close(): the hooks must clean this up.
  });

  it('gives the next test a fresh bus bound to its own Redis mock', async () => {
    expect(registry[EVENT_BUS_REGISTRY_KEY]).toBeUndefined();

    const before = createdBy.length;
    mockRedisFor('second', createdBy);
    const { getEventBus } = await import('../index');
    const bus = getEventBus();
    await bus.subscribe('CUSTOM_EVENT' as any, vi.fn(async () => undefined));

    expect(createdBy.slice(before)).toContain('second');
    expect(createdBy.slice(before)).not.toContain('first');

    await bus.close();
  });
});

describe('discardRegisteredEventBus', () => {
  it('unregisters the stale bus and closes it', async () => {
    const close = vi.fn(async () => undefined);
    registry[EVENT_BUS_REGISTRY_KEY] = { close };

    discardRegisteredEventBus();

    expect(registry[EVENT_BUS_REGISTRY_KEY]).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('swallows a failing close so cleanup cannot fail the next test', async () => {
    const close = vi.fn(async () => {
      throw new Error('already disconnected');
    });
    registry[EVENT_BUS_REGISTRY_KEY] = { close };

    discardRegisteredEventBus();
    await Promise.resolve();

    expect(registry[EVENT_BUS_REGISTRY_KEY]).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no bus is registered', () => {
    delete registry[EVENT_BUS_REGISTRY_KEY];
    expect(() => discardRegisteredEventBus()).not.toThrow();
  });
});
