import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { expect, it, vi } from 'vitest';

vi.unmock('redis');
vi.mock('@alga-psa/core/logger', () => ({ default: {
  info() {}, warn() {}, debug() {}, error() {},
} }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async () => process.env.REDIS_PASSWORD || undefined,
}));
vi.mock('../../lib/utils/getSecret', () => ({
  getSecret: async () => process.env.REDIS_PASSWORD || undefined,
}));

it('delivers across package bundles and the legacy server entry point, then reconnects after close', async () => {
  const tenant = randomUUID();
  const prefix = `bundle-test:${tenant}:`;
  const channel = `bundle-${tenant}`;
  const control = createClient({
    url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`,
    password: process.env.REDIS_PASSWORD || undefined,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
  });
  control.on('error', () => {});
  const openBuses = new Set<{ close(): Promise<void> }>();
  vi.stubEnv('REDIS_PREFIX', prefix);
  vi.stubEnv('REDIS_STREAM_BLOCKING_TIMEOUT', '100');
  try {
    await control.connect();
    const firstModule = await import('../../../../packages/event-bus/src/eventBus');
    const first = firstModule.getEventBus();
    openBuses.add(first);
    // Next can emit separate module copies for its main and EE subscriber
    // graphs. Preserve the first instance while evaluating the second copy.
    vi.resetModules();
    const secondModule = await import('../../../../packages/event-bus/src/eventBus');
    const second = secondModule.getEventBus();
    openBuses.add(second);
    const legacyModule = await import('../../lib/eventBus/index');
    const legacy = legacyModule.getEventBus();
    openBuses.add(legacy);
    const calendar = vi.fn(async (_event: { id: string }) => {});
    const search = vi.fn(async (_event: { id: string }) => {});
    const legacySearch = vi.fn(async (_event: { id: string }) => {});
    await first.subscribe('CUSTOM_EVENT', calendar, { channel, subscriberId: 'calendar' });
    await second.subscribe('CUSTOM_EVENT', search, { channel, subscriberId: 'search' });
    await legacy.subscribe('CUSTOM_EVENT', legacySearch, { channel, subscriberId: 'legacy-search' });
    for (let sequence = 0; sequence < 3; sequence++) {
      await second.publish({ eventType: 'CUSTOM_EVENT', payload: { tenantId: tenant } }, { channel, strict: true });
    }
    await expect.poll(() => [calendar.mock.calls.length, search.mock.calls.length, legacySearch.mock.calls.length], { timeout: 5000 }).toEqual([3, 3, 3]);
    const calendarIds = calendar.mock.calls.map(([event]) => event.id).sort();
    expect(new Set(calendarIds).size).toBe(3);
    expect(search.mock.calls.map(([event]) => event.id).sort()).toEqual(calendarIds);
    expect(legacySearch.mock.calls.map(([event]) => event.id).sort()).toEqual(calendarIds);
    expect(firstModule.isEventBusConnected()).toBe(true);
    expect(secondModule.isEventBusConnected()).toBe(true);
    expect(legacyModule.isEventBusConnected()).toBe(true);

    await first.close();
    openBuses.delete(first);
    expect(secondModule.isEventBusConnected()).toBe(false);
    expect(legacyModule.isEventBusConnected()).toBe(false);
    const reopened = firstModule.getEventBus();
    openBuses.add(reopened);
    const replacement = vi.fn(async () => {});
    await reopened.subscribe('CUSTOM_EVENT', replacement, { channel, subscriberId: 'replacement' });
    await reopened.publish({ eventType: 'CUSTOM_EVENT', payload: { tenantId: tenant } }, { channel, strict: true });
    await expect.poll(() => replacement.mock.calls.length, { timeout: 5000 }).toBe(1);
    // Closing a stale handle must not close the replacement connection.
    await second.close();
    expect(secondModule.isEventBusConnected()).toBe(true);
    expect([calendar.mock.calls.length, search.mock.calls.length, legacySearch.mock.calls.length]).toEqual([3, 3, 3]);
  } finally {
    for (const bus of openBuses) await bus.close();
    if (control.isOpen) {
      const keys = await control.keys(`${prefix}*`);
      keys.push(`processed_events:${tenant}:${channel}`, `processed_event_handlers:${tenant}:${channel}`);
      await control.del(keys);
      await control.quit();
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}, 30000);
