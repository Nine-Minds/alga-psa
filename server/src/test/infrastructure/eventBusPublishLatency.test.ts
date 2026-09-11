import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { expect, it, vi } from 'vitest';
vi.unmock('redis');
vi.mock('@alga-psa/core/logger', () => ({ default: { info() {}, warn() {}, debug() {}, error() {} } }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: async () => process.env.REDIS_PASSWORD || undefined }));
it('publishes during a blocking read and supports close/recreate', async () => {
  const tenantId = randomUUID(), userId = randomUUID();
  const prefix = `publish-latency:${tenantId}:`, channel = `latency-${tenantId}`;
  vi.stubEnv('REDIS_PREFIX', prefix); vi.stubEnv('REDIS_STREAM_BLOCKING_TIMEOUT', '5000');
  const control = createClient({ url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`,
    password: process.env.REDIS_PASSWORD || undefined, socket: { reconnectStrategy: false } });
  control.on('error', () => {});
  const { getEventBus } = await import('../../../../packages/event-bus/src/eventBus');
  let bus = getEventBus();
  try {
    await control.connect();
    for (let iteration = 0; iteration < 2; iteration++) {
      const existingClients = new Set((await control.clientList()).map(c => c.id));
      const received = vi.fn(async () => {});
      await bus.subscribe('SCHEDULE_ENTRY_CREATED', received, { channel });
      await expect.poll(async () => (await control.clientList()).some(c => !existingClients.has(c.id) && c.cmd === 'xreadgroup' && c.flags.includes('b')), { timeout: 5000 }).toBe(true);
      const started = performance.now();
      await bus.publish({ eventType: 'SCHEDULE_ENTRY_CREATED', payload: { tenantId, userId, entryId: randomUUID(), changes: {} } }, { channel, strict: true });
      expect(performance.now() - started).toBeLessThan(2000);
      await expect.poll(() => received.mock.calls.length, { timeout: 2000 }).toBe(1);
      await expect.poll(async () => (await control.clientList()).some(c => !existingClients.has(c.id) && c.cmd === 'xreadgroup' && c.flags.includes('b')), { timeout: 5000 }).toBe(true);
      const closeStarted = performance.now();
      await bus.close();
      expect(performance.now() - closeStarted).toBeLessThan(2000);
      expect(bus.isConnected()).toBe(false);
      if (iteration === 0) bus = getEventBus();
    }
  } finally {
    await bus.close();
    if (control.isOpen) {
      const keys = await control.keys(`${prefix}*`);
      keys.push(`processed_events:${tenantId}:${channel}`, `processed_event_handlers:${tenantId}:${channel}`);
      await control.del(keys); await control.quit();
    }
    vi.unstubAllEnvs(); vi.resetModules();
  }
}, 30000);
