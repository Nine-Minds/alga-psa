import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';

/**
 * alga-2026-0003322: the post-recreate catch-up and an inbound notification can
 * import the same external event at the same time. Both read "no mapping" and
 * create an entry; the loser hits the (tenant, external_event_id, provider)
 * unique index. That loss is a success, not a provider error.
 *
 * Real: CalendarSyncService, ScheduleEntry, every table. Mocked: the Graph
 * adapter, provider status I/O (kept on real rows), and the event bus.
 */
const context = vi.hoisted(() => ({
  db: null as Knex | null,
  tenant: '' as string,
  // Released once `parties` callers have finished their mapping lookup.
  barrier: null as null | { parties: number; arrived: number; release: () => void; gate: Promise<void> },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
    runWithTenant: async (_t: string, cb: () => Promise<unknown>) => cb(),
  };
});

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProvider(providerId: string, tenant: string) {
      const row = await tenantDb(context.db!, tenant).table('calendar_providers').where({ id: providerId, tenant }).first();
      if (!row) return null;
      return {
        id: row.id, tenant: row.tenant, user_id: row.user_id, name: row.provider_name,
        provider_type: row.provider_type, calendar_id: row.calendar_id, sync_direction: row.sync_direction,
        status: row.status, error_message: row.error_message,
        provider_config: { accessToken: 'at', refreshToken: 'rt' },
      };
    }
    async updateProviderStatus(providerId: string, u: { status: string; errorMessage?: string | null; lastSyncAt?: string }) {
      await tenantDb(context.db!, context.tenant).table('calendar_providers')
        .where({ id: providerId, tenant: context.tenant })
        .update({ status: u.status, error_message: u.errorMessage ?? null, updated_at: new Date() });
    }
  },
}));

const externalEvent = (id: string) => ({
  id,
  provider: 'microsoft' as const,
  title: 'Race meeting @alga',
  start: { dateTime: new Date(Date.now() + 3600_000).toISOString(), timeZone: 'UTC' },
  end: { dateTime: new Date(Date.now() + 7200_000).toISOString(), timeZone: 'UTC' },
  updated: new Date().toISOString(),
});

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: class {
    async connect() {}
    async getEvent(id: string) { return externalEvent(id); }
    getProviderStatusWarning() { return undefined; }
  },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter', () => ({ GoogleCalendarAdapter: class {} }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), hasPermission: async () => true }));
vi.mock('@/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));

import { CalendarSyncService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService';

describe('inbound sync: lost mapping unique-index race (DB-backed)', () => {
  const tenant = uuidv4();
  const userId = uuidv4();
  let db: Knex;
  let providerId: string;
  const t = (table: string) => tenantDb(db, tenant).table(table);

  beforeAll(async () => {
    db = await createTestDbConnection();
    context.db = db;
    context.tenant = tenant;
    await db.migrate.latest({ directory: process.env.TEST_MIGRATIONS_DIR || 'migrations' });
    await tenantDb(db, tenant).unscoped('tenants', 'race test fixture').insert({
      tenant, client_name: 'Race Tenant', email: 'race@example.com', created_at: new Date(), updated_at: new Date(),
    });
    await t('users').insert({
      tenant, user_id: userId, username: 'race-user', user_type: 'internal', hashed_password: 'x',
      email: 'race-user@example.com', created_at: new Date(), updated_at: new Date(),
    });
  });

  afterAll(async () => {
    if (!db) return;
    await t('calendar_event_mappings').del();
    await t('calendar_providers').del();
    await t('schedule_entry_assignees').del();
    await t('schedule_entries').del();
    await t('users').del();
    await tenantDb(db, tenant).unscoped('tenants', 'race test fixture').where({ tenant }).del();
    await db.destroy();
  });

  beforeEach(async () => {
    context.barrier = null;
    await t('calendar_event_mappings').del();
    await t('calendar_providers').del();
    await t('schedule_entry_assignees').del();
    await t('schedule_entries').del();
    providerId = uuidv4();
    await t('calendar_providers').insert({
      id: providerId, tenant, user_id: userId, provider_type: 'microsoft', provider_name: 'Race MS',
      calendar_id: 'calendar', is_active: true, sync_direction: 'bidirectional', status: 'connected',
      vendor_config: JSON.stringify({}), created_at: new Date(), updated_at: new Date(),
    });
  });

  it('two concurrent imports of one event leave one entry, one mapping and a non-error provider', async () => {
    const eventId = 'outlook-race-event';
    const service = new CalendarSyncService() as any;

    // Hold both callers after their (empty) mapping lookup, before either inserts.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    context.barrier = { parties: 2, arrived: 0, release, gate };
    const realLookup = service.getMappingByExternalEvent.bind(service);
    service.getMappingByExternalEvent = async (...args: unknown[]) => {
      const found = await (realLookup as any)(...args);
      const barrier = context.barrier;
      if (barrier) {
        barrier.arrived += 1;
        if (barrier.arrived >= barrier.parties) barrier.release();
        await barrier.gate;
      }
      return found;
    };

    const [a, b] = await Promise.all([
      service.syncExternalEventToSchedule(eventId, providerId),
      service.syncExternalEventToSchedule(eventId, providerId),
    ]);

    expect(context.barrier.arrived).toBe(2);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    // Exactly one call imported; the other lost the race and reported a skip.
    expect([a, b].filter((r) => r.skipped).length).toBe(1);
    expect([a, b].find((r) => r.skipped).reason).toBe('Concurrent sync already imported this event');

    const mappings = await t('calendar_event_mappings').where({ calendar_provider_id: providerId, external_event_id: eventId });
    expect(mappings).toHaveLength(1);
    // The loser's entry rolled back with its transaction.
    const entries = await t('schedule_entries').where({ title: 'Race meeting @alga' });
    expect(entries).toHaveLength(1);
    expect(entries[0].entry_id).toBe(mappings[0].schedule_entry_id);
    expect(await t('schedule_entries')).toHaveLength(1);

    const provider = await t('calendar_providers').where({ id: providerId }).first();
    expect(provider.status).toBe('connected');
    expect(provider.error_message).toBeNull();
  });

  it('a unique violation on any other constraint is still a provider error', async () => {
    const service = new CalendarSyncService() as any;
    service.getMappingByExternalEvent = async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint "some_other_unique"'), { code: '23505', constraint: 'some_other_unique' });
    };
    const result = await service.syncExternalEventToSchedule('outlook-other', providerId);
    expect(result.success).toBe(false);
    expect((await t('calendar_providers').where({ id: providerId }).first()).status).toBe('error');
  });
});
