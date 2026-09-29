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

it('isolates worktree routes while matching publishers and same-route replicas share delivery', async () => {
  const tenantId = randomUUID();
  const eventId = randomUUID();
  const channel = `worktree-route-${randomUUID()}`;
  const prefixA = `route-isolation-a:${randomUUID()}:`;
  const prefixB = `route-isolation-b:${randomUUID()}:`;
  const control = createClient({
    url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`,
    password: process.env.REDIS_PASSWORD || undefined,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
  });
  control.on('error', () => {});

  let busA: any;
  let replicaA: any;
  let busB: any;
  const openBuses = new Set<any>();
  const deliveries = { a1: 0, a2: 0, b: 0 };
  const event = {
    eventType: 'SCHEDULE_ENTRY_CREATED' as const,
    payload: { tenantId, userId: randomUUID(), entryId: randomUUID(), changes: { assignedUserIds: [] } },
  };

  vi.stubEnv('REDIS_STREAM_BLOCKING_TIMEOUT', '100');
  vi.stubEnv('REDIS_PREFIX', prefixA);
  try {
    await control.connect();

    const routeA = await import('../../../../packages/event-bus/src/eventBus');
    busA = new (routeA.EventBus as any)();
    busA.consumerName = `route-a-primary-${process.pid}`;
    replicaA = new (routeA.EventBus as any)();
    replicaA.consumerName = `route-a-replica-${process.pid}`;
    openBuses.add(busA);
    openBuses.add(replicaA);
    await busA.subscribe('SCHEDULE_ENTRY_CREATED', async () => { deliveries.a1 += 1; }, { channel });
    await replicaA.subscribe('SCHEDULE_ENTRY_CREATED', async () => { deliveries.a2 += 1; }, { channel });

    // A second process has its own config snapshot, as a separate worktree
    // does, but points at the same Redis endpoint and uses the same group name.
    vi.resetModules();
    vi.stubEnv('REDIS_PREFIX', prefixB);
    const routeB = await import('../../../../packages/event-bus/src/eventBus');
    busB = new (routeB.EventBus as any)();
    busB.consumerName = `route-b-${process.pid}`;
    openBuses.add(busB);
    await busB.subscribe('SCHEDULE_ENTRY_CREATED', async () => { deliveries.b += 1; }, { channel });

    await busA.publish(event, { channel, eventId, strict: true });
    await expect.poll(() => deliveries.a1 + deliveries.a2, { timeout: 5000 }).toBe(1);
    expect(deliveries.b).toBe(0);

    // A publisher and subscriber using route B still agree, and A's replicas
    // continue to compete in their own event-processors group.
    await busB.publish({ ...event, payload: { ...event.payload, entryId: randomUUID() } }, { channel, strict: true });
    await expect.poll(() => deliveries.b, { timeout: 5000 }).toBe(1);
    expect(deliveries.a1 + deliveries.a2).toBe(1);
    const groupsA = await control.xInfoGroups(`${prefixA}event-stream:${channel}:SCHEDULE_ENTRY_CREATED`);
    const groupsB = await control.xInfoGroups(`${prefixB}event-stream:${channel}:SCHEDULE_ENTRY_CREATED`);
    expect(groupsA.map(({ name }) => name)).toContain('event-processors');
    expect(groupsB.map(({ name }) => name)).toContain('event-processors');
    expect(groupsA[0].consumers).toBeGreaterThanOrEqual(1);
    expect(groupsB[0].consumers).toBeGreaterThanOrEqual(1);
  } finally {
    for (const bus of openBuses) await bus.close();
    if (control.isOpen) {
      const keys = await control.keys(`${prefixA}*`);
      keys.push(...await control.keys(`${prefixB}*`));
      keys.push(`processed_events:${tenantId}:${channel}`, `processed_event_handlers:${tenantId}:${channel}`);
      if (keys.length) await control.del(keys);
      await control.quit();
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}, 30000);
