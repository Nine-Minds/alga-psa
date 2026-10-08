import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  facade: null as any,
  tenant: '', user: '', provider: '',
  sync: vi.fn(async (_entryId: string, _providerId: string) => ({ success: true, externalEventId: '' })),
  mappings: [] as Array<{ tenant: string; entryId: string; providerId: string; externalEventId: string }>,
  upsert: vi.fn(async () => undefined),
  load: vi.fn(async (_db: unknown, tenant: string, id: string) => ({ tenant, objectId: id })),
}));
vi.unmock('redis');
vi.mock('@alga-psa/core/logger', () => ({ default: { info() {}, warn() {}, debug() {}, error() {} } }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: async () => process.env.REDIS_PASSWORD || undefined }));
vi.mock('@alga-psa/event-bus', () => ({ getEventBus: () => state.facade }));
vi.mock('../../lib/eventBus/index', () => ({ getEventBus: () => state.facade }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: state.tenant }),
  runWithTenant: async (_tenant: string, callback: () => Promise<unknown>) => callback(),
  tenantDb: vi.fn(),
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProviders() {
      return [{ id: state.provider, tenant: state.tenant, user_id: state.user, sync_direction: 'bidirectional' }];
    }
  },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: class { syncScheduleEntryToExternal = state.sync; },
}));
vi.mock('@alga-psa/search', () => ({
  allIndexers: () => [{ objectType: 'schedule_entry', sourceEvents: ['SCHEDULE_ENTRY_CREATED'], loadOne: state.load }],
  getIndexer: vi.fn(),
}));
vi.mock('@alga-psa/search/upsert', () => ({ upsertSearchDoc: state.upsert, deleteSearchDoc: vi.fn() }));

it('delivers one schedule event to actual calendar and search registrations even when bundled handler names collide', async () => {
  state.tenant = randomUUID(); state.user = randomUUID(); state.provider = randomUUID();
  state.mappings.length = 0;
  state.sync.mockImplementation(async (entryId, providerId) => {
    const externalEventId = `external-${entryId}`;
    state.mappings.push({ tenant: state.tenant, entryId, providerId, externalEventId });
    return { success: true, externalEventId };
  });
  const entryId = randomUUID();
  const prefix = `subscriber-identity:${state.tenant}:`;
  const channel = `subscriber-${state.tenant}`;
  vi.stubEnv('REDIS_PREFIX', prefix);
  vi.stubEnv('REDIS_STREAM_BLOCKING_TIMEOUT', '100');
  vi.stubEnv('SEARCH_INDEX_LIVE', 'true');
  const control = createClient({
    url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || '6379'}`,
    password: process.env.REDIS_PASSWORD || undefined,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
  });
  control.on('error', () => {});
  const { getEventBus } = await import('../../../../packages/event-bus/src/eventBus');
  const bus = getEventBus();
  state.facade = {
    subscribe: async (type: any, handler: any, options: any) => {
      // Independent production bundles can choose the same short name.
      // Keep the actual registration's identity and the real Redis consumer.
      Object.defineProperty(handler, 'name', { value: 'a', configurable: true });
      return bus.subscribe(type, handler, { ...options, channel });
    },
  };
  try {
    await control.connect();
    const calendar = await import('../../../../ee/packages/calendar/src/lib/eventBus/subscribers/calendarSyncSubscriber');
    const search = await import('../../lib/eventBus/subscribers/searchIndexSubscriber');
    await calendar.registerCalendarSyncSubscriber();
    await search.registerSearchIndexSubscriber();
    await bus.publish({ eventType: 'SCHEDULE_ENTRY_CREATED', payload: {
      tenantId: state.tenant, userId: state.user, entryId, changes: { assignedUserIds: [state.user] },
    } }, { channel, strict: true });
    await expect.poll(() => [state.sync.mock.calls.length, state.upsert.mock.calls.length], { timeout: 5000 }).toEqual([1, 1]);
    expect(state.sync).toHaveBeenCalledWith(entryId, state.provider);
    // The automatic EventBus -> calendar subscriber path must reach the sync
    // operation that creates the provider mapping; a direct service call would
    // not catch a publisher/subscriber route mismatch.
    expect(state.mappings).toEqual([{ tenant: state.tenant, entryId, providerId: state.provider, externalEventId: `external-${entryId}` }]);
    expect(state.upsert).toHaveBeenCalledWith({}, { tenant: state.tenant, objectId: entryId });
  } finally {
    await bus.close();
    if (control.isOpen) {
      const keys = await control.keys(`${prefix}*`);
      keys.push(`${prefix}processed_events:${state.tenant}:${channel}`, `${prefix}processed_event_handlers:${state.tenant}:${channel}`);
      await control.del(keys);
      await control.quit();
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}, 30000);
