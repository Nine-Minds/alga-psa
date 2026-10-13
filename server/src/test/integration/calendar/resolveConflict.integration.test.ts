import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';

const modulePaths = vi.hoisted(() => {
  // The server db module moved from index.tsx to index.ts — mock the current file.
  const libDbModulePath = new URL('../../../lib/db/index.ts', import.meta.url).pathname;
  const rootDbModulePath = new URL('../../../db.ts', import.meta.url).pathname;
  const rbacModulePath = new URL('../../../lib/auth/rbac.ts', import.meta.url).pathname;

  return {
    libDbModulePath,
    libDbModulePathNoExt: libDbModulePath.replace(/\.tsx?$/, ''),
    rootDbModulePath,
    rootDbModulePathNoExt: rootDbModulePath.replace(/\.ts$/, ''),
    rbacModulePath,
    rbacModulePathNoExt: rbacModulePath.replace(/\.ts$/, ''),
  };
});

const context = vi.hoisted(() => ({
  db: null as Knex | null,
  tenant: null as string | null,
  defaultTenant: null as string | null,
  userId: null as string | null,
  secondUserId: null as string | null,
  canViewAll: true,
  scheduleEntryColumns: {} as Record<string, { nullable: boolean }>,
  providerEvents: new Map<string, any>(),
  providerCalls: [] as Array<{ providerId: string; operation: string; eventId?: string; event?: any }>,
  providerReadFailures: new Map<string, Error>(),
  providerWriteFailures: new Map<string, Error>(),
  nextEventNumber: 1,
  // Runs on a pool connection (not the sync's transaction) right after a
  // provider is marked connected, to observe what other readers can see then.
  onProviderConnected: null as null | (() => Promise<void>),
  // Ordered trace of transaction lifecycle + provider writes, with the number of
  // transactions already open when each transaction started.
  trace: [] as string[],
  txDepth: 0,
  txStartDepths: [] as number[],
}));

function buildDbExports() {
  return {
    createTenantKnex: async () => {
      if (!context.db) {
        throw new Error('[manualSync.integration] Test database has not been initialized');
      }
      return {
        knex: context.db,
        tenant: context.tenant ?? context.defaultTenant ?? null,
      };
    },
    runWithTenant: async (tenant: string, cb: () => Promise<any>) => {
      const previous = context.tenant;
      context.tenant = tenant;
      try {
        return await cb();
      } finally {
        context.tenant = previous;
      }
    },
    getTenantContext: async () => context.tenant ?? context.defaultTenant ?? undefined,
    getCurrentTenantId: async () => context.tenant ?? context.defaultTenant ?? null,
  };
}

vi.mock(modulePaths.libDbModulePath, () => buildDbExports());
vi.mock(modulePaths.libDbModulePathNoExt, () => buildDbExports());
vi.mock(modulePaths.rootDbModulePath, () => buildDbExports());
vi.mock(modulePaths.rootDbModulePathNoExt, () => buildDbExports());

// The EE calendar impl resolves its connection/tenant context via @alga-psa/db.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    ...buildDbExports(),
    withTransaction: async (knex: any, cb: any, ...rest: any[]) => {
      context.txStartDepths.push(context.txDepth);
      context.trace.push('tx:start');
      context.txDepth++;
      try {
        return await (actual.withTransaction as any)(knex, cb, ...rest);
      } finally {
        context.txDepth--;
        context.trace.push('tx:end');
      }
    },
  };
});

// The EE calendar actions are withAuth-wrapped; inject the test user directly.
vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(
      { user_id: context.userId, tenant: context.defaultTenant, user_type: 'internal' },
      { tenant: context.defaultTenant },
      ...args
    ),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(
      { user_id: context.userId, tenant: context.defaultTenant, user_type: 'internal' },
      { tenant: context.defaultTenant },
      ...args
    ),
  withAuthCheck: (action: any) => (...args: any[]) =>
    action({ user_id: context.userId, tenant: context.defaultTenant, user_type: 'internal' }, ...args),
}));

const providerTenantMap = vi.hoisted(() => new Map<string, string>());

function contextTenantTable(table: string, tenant: string) {
  if (!context.db) {
    throw new Error('Database not initialized');
  }
  return tenantDb(context.db, tenant).table(table);
}

function tenantTable(db: Knex, tenant: string, table: string) {
  return tenantDb(db, tenant).table(table);
}

function tenantRows(db: Knex, tenant: string) {
  return tenantDb(db, tenant).unscoped('tenants', 'manual calendar sync test fixture creates and removes tenant rows');
}

function schemaTable(db: Knex, table: string) {
  return tenantDb(db, '__manual_calendar_sync_schema__').unscoped(table, 'manual calendar sync test reads schema metadata');
}

// The EE calendar action impl lives in @alga-psa/ee-calendar and imports its
// services from that package (not @enterprise) — mock those specifiers.
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProvider(providerId: string, tenant: string) {
      if (!context.db) {
        throw new Error('Database not initialized');
      }
      const row = await contextTenantTable('calendar_providers', tenant)
        .where({ id: providerId, tenant })
        .first();
      if (!row) {
        return null;
      }
      providerTenantMap.set(providerId, row.tenant);
      return {
        id: row.id,
        tenant: row.tenant,
        user_id: row.user_id,
        name: row.provider_name,
        provider_type: row.provider_type,
        calendar_id: row.calendar_id,
        sync_direction: row.sync_direction,
        status: row.status,
        last_sync_at: row.last_sync_at,
        error_message: row.error_message,
        // syncCalendarProviderImpl refuses providers whose OAuth flow never
        // completed (errorCode 'not_authorized'); the real service reads these
        // from the vendor config table.
        provider_config: {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
        },
      };
    }

    async updateProviderStatus(
      providerId: string,
      updates: { status: 'connected' | 'disconnected' | 'error' | 'configuring'; errorMessage?: string | null; lastSyncAt?: string }
    ) {
      if (!context.db) {
        throw new Error('Database not initialized');
      }
      const tenant = providerTenantMap.get(providerId) ?? context.defaultTenant;
      if (!tenant) {
        throw new Error(`Tenant not known for provider ${providerId}`);
      }
      await contextTenantTable('calendar_providers', tenant)
        .where({ id: providerId, tenant })
        .update({
          status: updates.status,
          error_message: updates.errorMessage ?? null,
          last_sync_at: updates.lastSyncAt ? new Date(updates.lastSyncAt) : null,
          updated_at: new Date(),
        });
      if (updates.status === 'connected') {
        await context.onProviderConnected?.();
      }
    }
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({
    tenant: context.defaultTenant,
    user_id: context.userId,
  })),
}));

vi.mock(modulePaths.rbacModulePath, () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock(modulePaths.rbacModulePathNoExt, () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return { ...actual, hasPermission: async () => context.canViewAll };
});

vi.mock('@/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// Stateful provider doubles are used by the real CalendarSyncService called
// from syncCalendarProviderImpl. They model event bodies and update timestamps
// while recording every provider write for assertions.
function createStatefulAdapter(provider: any) {
  const key = (eventId: string) => `${provider.id}:${eventId}`;
  return {
    async connect() {},
    async registerWebhookSubscription() {},
    async renewWebhookSubscription() {},
    async getEvent(eventId: string) {
      context.providerCalls.push({ providerId: provider.id, operation: 'get', eventId });
      const failure = context.providerReadFailures.get(provider.id);
      if (failure) throw failure;
      const event = context.providerEvents.get(key(eventId));
      if (!event) throw Object.assign(new Error('Provider event not found'), { status: 404 });
      return structuredClone(event);
    },
    async createEvent(event: any) {
      const eventId = `manual-sync-${context.nextEventNumber++}`;
      const stored = { ...structuredClone(event), id: eventId, updated: new Date(Date.now() + 5000).toISOString() };
      context.providerEvents.set(key(eventId), stored);
      context.trace.push('adapter:create');
      context.providerCalls.push({ providerId: provider.id, operation: 'create', eventId, event: structuredClone(stored) });
      return structuredClone(stored);
    },
    async updateEvent(eventId: string, event: any) {
      const failure = context.providerWriteFailures.get(provider.id);
      if (failure) throw failure;
      const existing = context.providerEvents.get(key(eventId));
      if (!existing) throw Object.assign(new Error('Provider event not found'), { status: 404 });
      const stored = { ...existing, ...structuredClone(event), id: eventId, updated: new Date(Date.now() + 10_000).toISOString() };
      context.providerEvents.set(key(eventId), stored);
      context.trace.push('adapter:update');
      context.providerCalls.push({ providerId: provider.id, operation: 'update', eventId, event: structuredClone(stored) });
      return structuredClone(stored);
    },
    async deleteEvent(eventId: string) {
      context.providerEvents.delete(key(eventId));
      context.providerCalls.push({ providerId: provider.id, operation: 'delete', eventId });
    },
  };
}

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter', () => ({
  GoogleCalendarAdapter: class {
    private adapter: ReturnType<typeof createStatefulAdapter>;
    constructor(provider: any) { this.adapter = createStatefulAdapter(provider); }
    connect() { return this.adapter.connect(); }
    getEvent(eventId: string) { return this.adapter.getEvent(eventId); }
    createEvent(event: any) { return this.adapter.createEvent(event); }
    updateEvent(eventId: string, event: any) { return this.adapter.updateEvent(eventId, event); }
    deleteEvent(eventId: string) { return this.adapter.deleteEvent(eventId); }
    registerWebhookSubscription() { return this.adapter.registerWebhookSubscription(); }
  },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: class {
    private adapter: ReturnType<typeof createStatefulAdapter>;
    constructor(provider: any) { this.adapter = createStatefulAdapter(provider); }
    connect() { return this.adapter.connect(); }
    getEvent(eventId: string) { return this.adapter.getEvent(eventId); }
    createEvent(event: any) { return this.adapter.createEvent(event); }
    updateEvent(eventId: string, event: any) { return this.adapter.updateEvent(eventId, event); }
    deleteEvent(eventId: string) { return this.adapter.deleteEvent(eventId); }
    registerWebhookSubscription() { return this.adapter.registerWebhookSubscription(); }
    renewWebhookSubscription() { return this.adapter.renewWebhookSubscription(); }
    getProviderStatusWarning() { return undefined; }
  },
}));
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookMaintenanceService', () => ({
  CalendarWebhookMaintenanceService: class {},
}));

// Import the EE action directly: it is what the EE settings UI calls. (The CE
// wrapper in @alga-psa/integrations delegates to `*Impl` exports that
// @alga-psa/ee-calendar/actions does not expose, so it reports calendar sync
// unavailable even on EE.)
import { syncCalendarProvider } from '@alga-psa/ee-calendar/actions';

import { CalendarSyncService } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService';

describe('CalendarSyncService.resolveConflict (EE) transaction handling', () => {
  const testTenant = uuidv4();
  const testUserId = uuidv4();
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    context.db = db;
    context.defaultTenant = testTenant;
    context.userId = testUserId;
    await db.migrate.latest({ directory: process.env.TEST_MIGRATIONS_DIR || 'migrations' });
    context.scheduleEntryColumns = await schemaTable(db, 'schedule_entries').columnInfo();
    await tenantRows(db, testTenant).insert({
      tenant: testTenant,
      client_name: 'Resolve Conflict Tenant',
      email: 'resolve-conflict@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict('tenant').ignore();
    await tenantTable(db, testTenant, 'users').insert({
      tenant: testTenant,
      user_id: testUserId,
      username: 'resolve-conflict-user',
      user_type: 'internal',
      hashed_password: 'not-used',
      email: 'resolve-conflict-user@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict(['tenant', 'user_id']).ignore();
  });

  afterAll(async () => {
    if (db) {
      await cleanTables();
      await tenantTable(db, testTenant, 'users').where({ user_id: testUserId }).del();
      await tenantRows(db, testTenant).where({ tenant: testTenant }).del();
      await db.destroy();
    }
  });

  async function cleanTables() {
    await tenantTable(db, testTenant, 'calendar_event_mappings').del();
    await tenantTable(db, testTenant, 'calendar_providers').del();
    await tenantTable(db, testTenant, 'schedule_entry_assignees').del();
    await tenantTable(db, testTenant, 'schedule_entries').del();
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    context.tenant = null;
    context.providerEvents.clear();
    context.providerCalls.length = 0;
    context.providerReadFailures.clear();
    context.providerWriteFailures.clear();
    context.nextEventNumber = 1;
    context.onProviderConnected = null;
    context.trace.length = 0;
    context.txStartDepths.length = 0;
    context.txDepth = 0;
    providerTenantMap.clear();
    await cleanTables();
  });

  async function seedConflict() {
    const providerId = uuidv4();
    const entryId = uuidv4();
    const mappingId = uuidv4();
    const externalEventId = 'ext-conflict-1';
    const now = new Date();
    await tenantTable(db, testTenant, 'calendar_providers').insert({
      id: providerId,
      tenant: testTenant,
      user_id: testUserId,
      provider_type: 'google',
      provider_name: 'Conflict Provider',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'bidirectional',
      status: 'connected',
      vendor_config: JSON.stringify({}),
      created_at: now,
      updated_at: now,
    });
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const record: Record<string, any> = {
      tenant: testTenant,
      entry_id: entryId,
      title: 'Alga Title',
      scheduled_start: start,
      scheduled_end: end,
      status: 'scheduled',
      notes: 'Alga notes',
      created_at: now,
      updated_at: now,
    };
    const cols = context.scheduleEntryColumns;
    if (cols.work_item_type) record.work_item_type = 'ad_hoc';
    if (cols.work_item_id) record.work_item_id = uuidv4();
    if (cols.user_id) record.user_id = testUserId;
    if (cols.is_private) record.is_private = false;
    if (cols.is_recurring) record.is_recurring = false;
    if (cols.recurrence_pattern) record.recurrence_pattern = null;
    if (cols.original_entry_id) record.original_entry_id = null;
    if (cols.duration_minutes) record.duration_minutes = 60;
    await tenantTable(db, testTenant, 'schedule_entries').insert(record);
    await tenantTable(db, testTenant, 'schedule_entry_assignees').insert({
      tenant: testTenant, entry_id: entryId, user_id: testUserId,
    });
    await tenantTable(db, testTenant, 'calendar_event_mappings').insert({
      id: mappingId,
      tenant: testTenant,
      calendar_provider_id: providerId,
      schedule_entry_id: entryId,
      external_event_id: externalEventId,
      sync_status: 'conflict',
      sync_direction: 'to_external',
      alga_last_modified: new Date(now.getTime() - 60_000),
      external_last_modified: new Date(now.getTime() - 30_000),
      created_at: now,
      updated_at: now,
    });
    context.providerEvents.set(`${providerId}:${externalEventId}`, {
      id: externalEventId,
      provider: 'google',
      title: 'External Title',
      description: 'External notes',
      start: { dateTime: new Date(start.getTime() + 30 * 60 * 1000).toISOString() },
      end: { dateTime: new Date(end.getTime() + 30 * 60 * 1000).toISOString() },
      status: 'confirmed',
      updated: new Date(Date.now() + 1000).toISOString(),
    });
    return { providerId, entryId, mappingId, externalEventId };
  }

  const readEntry = (entryId: string) =>
    tenantTable(db, testTenant, 'schedule_entries').where({ tenant: testTenant, entry_id: entryId }).first();
  const readMappingById = (mappingId: string) =>
    tenantTable(db, testTenant, 'calendar_event_mappings').where({ tenant: testTenant, id: mappingId }).first();

  it('T1: merge pushes the merged data to the provider and records the new updated_at', async () => {
    const { mappingId, entryId } = await seedConflict();

    const result = await new CalendarSyncService().resolveConflict(mappingId, 'merge', { title: 'Merged' });
    expect(result.success).toBe(true);

    const writes = context.providerCalls.filter(c => c.operation === 'update' || c.operation === 'create');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[writes.length - 1].event.title).toBe('Merged');

    const entry = await readEntry(entryId);
    expect(entry.title).toBe('Merged');
    const mapping = await readMappingById(mappingId);
    expect(mapping.sync_status).toBe('synced');
    expect(new Date(mapping.alga_last_modified).getTime()).toBe(new Date(entry.updated_at).getTime());
  });

  it('T2: alga resolution pushes the current entry and marks the mapping synced', async () => {
    const { mappingId } = await seedConflict();

    const result = await new CalendarSyncService().resolveConflict(mappingId, 'alga');
    expect(result.success).toBe(true);

    const writes = context.providerCalls.filter(c => c.operation === 'update' || c.operation === 'create');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[writes.length - 1].event.title).toBe('Alga Title');
    expect((await readMappingById(mappingId)).sync_status).toBe('synced');
  });

  it('T3: external resolution applies the external event to the entry and marks the mapping synced', async () => {
    const { mappingId, entryId } = await seedConflict();

    const result = await new CalendarSyncService().resolveConflict(mappingId, 'external');
    expect(result.success).toBe(true);

    expect((await readEntry(entryId)).title).toBe('External Title');
    expect((await readMappingById(mappingId)).sync_status).toBe('synced');
  });

  it.each(['alga', 'external'] as const)('T4: %s resolution never starts a transaction inside another', async resolution => {
    const { mappingId } = await seedConflict();

    const result = await new CalendarSyncService().resolveConflict(mappingId, resolution);
    expect(result.success).toBe(true);

    // Only the callee's own transaction is opened (no outer wrapper), and it is
    // never nested: exactly one tx:start/tx:end pair, started at depth 0.
    expect(context.txStartDepths).toEqual([0]);
    expect(context.trace.filter(t => t.startsWith('tx:'))).toEqual(['tx:start', 'tx:end']);
  });

  it('T4: merge commits the update transaction before the provider is called', async () => {
    const { mappingId } = await seedConflict();

    const result = await new CalendarSyncService().resolveConflict(mappingId, 'merge', { title: 'Merged' });
    expect(result.success).toBe(true);

    expect(context.trace[0]).toBe('tx:start');
    expect(context.trace[1]).toBe('tx:end');
    expect(context.trace.indexOf('tx:end')).toBeLessThan(
      context.trace.findIndex(t => t.startsWith('adapter:'))
    );
    expect(context.txStartDepths.every(depth => depth === 0)).toBe(true);
  });

  it('T5: merge returns a failure and does not call the provider when the update returns nothing', async () => {
    const { mappingId, entryId } = await seedConflict();
    vi.spyOn(ScheduleEntry, 'update').mockResolvedValueOnce(undefined);

    const result = await new CalendarSyncService().resolveConflict(mappingId, 'merge', { title: 'Merged' });

    expect(result).toEqual({ success: false, error: 'Failed to merge schedule entry' });
    expect(context.providerCalls.filter(c => c.operation === 'update' || c.operation === 'create')).toHaveLength(0);
    expect(context.trace.some(t => t.startsWith('adapter:'))).toBe(false);
    expect((await readEntry(entryId)).title).toBe('Alga Title');
  });
});
