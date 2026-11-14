import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getSecret: vi.fn() }));
vi.mock('redis', () => ({ createClient: mocks.createClient }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: mocks.getSecret }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('EventBus correlated request completion', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function configureRedis() {
    const values = new Map<string, string>();
    mocks.getSecret.mockResolvedValue('');
    mocks.createClient.mockImplementation(() => {
      const client = new EventEmitter() as EventEmitter & Record<string, any>;
      client.connect = vi.fn(async () => { client.emit('connect'); client.emit('ready'); });
      client.quit = vi.fn(async () => { client.emit('end'); });
      client.set = vi.fn(async (key: string, value: string, options?: { NX?: boolean }) => {
        if (options?.NX && values.has(key)) return null;
        values.set(key, value);
        return 'OK';
      });
      client.get = vi.fn(async (key: string) => values.get(key) ?? null);
      client.exists = vi.fn(async (key: string) => Number(values.has(key)));
      client.del = vi.fn(async (key: string) => Number(values.delete(key)));
      return client;
    });
    return values;
  }

  it('waits for correlated success and rejects a correlated server failure', async () => {
    configureRedis();
    const { getEventBus } = await import('./eventBus');
    const bus = getEventBus();
    const successId = 'request-success';
    await bus.beginRequest(successId, 30);
    const success = bus.waitForRequest(successId, 1000);
    await bus.completeRequest(successId, { success: true });
    await expect(success).resolves.toBeUndefined();

    const failureId = 'request-failure';
    await bus.beginRequest(failureId, 30);
    const failure = bus.waitForRequest(failureId, 1000);
    await bus.completeRequest(failureId, { success: false, error: 'PDF rendering failed' });
    await expect(failure).rejects.toThrow('PDF rendering failed');
    await bus.close();
  });

  it('rejects when the server does not complete before the request timeout', async () => {
    configureRedis();
    const { getEventBus } = await import('./eventBus');
    const bus = getEventBus();
    const requestId = 'request-timeout';
    await bus.beginRequest(requestId, 30);
    await expect(bus.waitForRequest(requestId, 5)).rejects.toThrow('Timed out waiting for server execution request');
    await bus.close();
  });
});
