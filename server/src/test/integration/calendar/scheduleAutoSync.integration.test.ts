import { beforeAll, afterAll, beforeEach, describe, expect, it, vi, waitFor } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import { addScheduleEntry, updateScheduleEntry, deleteScheduleEntry } from '@alga-psa/scheduling/actions/scheduleActions';
import { registerCalendarSyncSubscriber } from '../../../lib/eventBus/subscribers/calendarSyncSubscriber';

const modulePaths = vi.hoisted(() => {
  // @alga-psa/db's knexfile snapshots DB_NAME_SERVER into its module-level
  // baseConfig at import time — before beforeAll's createTestDbConnection can
  // set it — so pin the test database name ahead of the import graph.
  process.env.DB_NAME_SERVER = 'test_database';

  // server/src/lib/db moved from index.tsx to index.ts in the facade migration.
  const libDbModulePath = new URL('../../../lib/db/index.ts', import.meta.url).pathname;
  const rootDbModulePath = new URL('../../../db.ts', import.meta.url).pathname;

  return {
    libDbModulePath,
    libDbModulePathNoExt: libDbModulePath.replace(/\.ts$/, ''),
    rootDbModulePath,
    rootDbModulePathNoExt: rootDbModulePath.replace(/\.ts$/, ''),
  };
});

const shared = vi.hoisted(() => ({
  db: null as Knex | null,
  defaultTenant: '' as string,
  userId: '' as string,
  providerId: '' as string,
  scheduleEntryColumns: {} as Record<string, { nullable: boolean }>,
  syncCalls: [] as Array<{ entryId: string; providerId: string }>,
  permissions: ['user_schedule:read', 'user_schedule:update'] as string[],
  deleteCalls: [] as Array<{ entryId: string; providerId: string; scope: string }>,
}));

const eventHandlers = vi.hoisted(() => new Map<string, Set<(event: any) => Promise<void>>>());

function sharedTenantTable(table: string, tenant: string) {
  if (!shared.db) {
    throw new Error('Database not initialized');
  }
  return tenantDb(shared.db, tenant).table(table);
}

function tenantTable(db: Knex, tenant: string, table: string) {
  return tenantDb(db, tenant).table(table);
}

function tenantRows(db: Knex, tenant: string) {
  return tenantDb(db, tenant).unscoped('tenants', 'schedule auto sync test fixture creates and removes tenant rows');
}

function schemaTable(db: Knex, table: string) {
  return tenantDb(db, '__schedule_auto_sync_schema__').unscoped(table, 'schedule auto sync test reads schema metadata');
}

function buildDbExports() {
  return {
    createTenantKnex: async () => {
      if (!shared.db) {
        throw new Error('[scheduleAutoSync.integration] Database not initialized');
      }
      return {
        knex: shared.db,
        tenant: shared.defaultTenant,
      };
    },
    runWithTenant: async (_tenant: string, cb: () => Promise<any>) => cb(),
    getTenantContext: async () => shared.defaultTenant,
    // Must be synchronous: the setup.ts @alga-psa/auth mock resolves the
    // withAuth tenant from getCurrentTenantId() and requires a string (a
    // Promise makes it fall back to the default 00000000-… tenant).
    getCurrentTenantId: () => shared.defaultTenant,
  };
}

vi.mock(modulePaths.libDbModulePath, () => buildDbExports());
vi.mock(modulePaths.libDbModulePathNoExt, () => buildDbExports());
vi.mock(modulePaths.rootDbModulePath, () => buildDbExports());
vi.mock(modulePaths.rootDbModulePathNoExt, () => buildDbExports());

// The calendar sync subscriber (now in @alga-psa/ee-calendar) and the
// scheduleActions publishers both go through @alga-psa/event-bus getEventBus;
// mock it with a synchronous in-memory bus so publish → handler is deterministic.
vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({
    subscribe: async (eventType: string, handler: (event: any) => Promise<void>) => {
      const handlers = eventHandlers.get(eventType) ?? new Set();
      handlers.add(handler);
      eventHandlers.set(eventType, handlers);
    },
    unsubscribe: async (eventType: string, handler: (event: any) => Promise<void>) => {
      eventHandlers.get(eventType)?.delete(handler);
    },
    publish: async (event: { eventType: string; payload: any }) => {
      const handlers = eventHandlers.get(event.eventType);
      if (!handlers) return;
      for (const handler of handlers) {
        await handler({
          id: `event-${Date.now()}`,
          timestamp: new Date().toISOString(),
          eventType: event.eventType,
          payload: event.payload,
        });
      }
    },
  }),
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({
    tenant: shared.defaultTenant,
    user_id: shared.userId,
  })),
  getCurrentUserPermissions: vi.fn(async () => shared.permissions),
}));

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: class {
    async syncScheduleEntryToExternal(entryId: string, providerId: string) {
      shared.syncCalls.push({ entryId, providerId });
      return { success: true, externalEventId: `ext-${entryId}` };
    }
    async syncExternalEventToSchedule() {
      return { success: true, scheduleEntryId: uuidv4() };
    }
    async resolveConflict() {
      return { success: true };
    }
    async deleteScheduleEntry(entryId: string, providerId: string, scope: string) {
      shared.deleteCalls.push({ entryId, providerId, scope });
      return { success: true };
    }
  },
}));

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProviders(filter: { tenant: string; isActive?: boolean }) {
      if (!shared.db) throw new Error('Database not initialized');
      const query = sharedTenantTable('calendar_providers', filter.tenant).where('tenant', filter.tenant);
      if (filter.isActive !== undefined) {
        query.andWhere('is_active', filter.isActive);
      }
      return await query.select('*');
    }
  },
}));

describe('Schedule entry creation triggers calendar sync', () => {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const providerId = uuidv4();
  let db: Knex;
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeAll(async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    eventHandlers.clear();
    db = await createTestDbConnection();
    await db.migrate.latest();
    shared.db = db;
    shared.defaultTenant = tenantId;
    shared.userId = userId;
    shared.providerId = providerId;

    shared.scheduleEntryColumns = await schemaTable(db, 'schedule_entries').columnInfo();

    await tenantRows(db, tenantId)
      .insert({
        tenant: tenantId,
        client_name: 'Auto Sync Tenant',
        email: 'auto-sync@example.com',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict('tenant')
      .ignore();

    await tenantTable(db, tenantId, 'users')
      .insert({
        tenant: tenantId,
        user_id: userId,
        username: 'auto-sync-user',
        hashed_password: 'irrelevant',
        email: 'auto-sync-user@example.com',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['tenant', 'user_id'])
      .ignore();

    await tenantTable(db, tenantId, 'calendar_providers').insert({
      id: providerId,
      tenant: tenantId,
      // The subscriber only syncs user-scoped providers whose user is
      // assigned to the entry; legacy tenant-level rows are skipped.
      user_id: userId,
      provider_type: 'google',
      provider_name: 'Auto Sync Provider',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'bidirectional',
      status: 'connected',
      last_sync_at: null,
      error_message: null,
      vendor_config: JSON.stringify({}),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await registerCalendarSyncSubscriber();
  });

  afterAll(async () => {
    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }

    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }

    if (db) {
      await tenantTable(db, tenantId, 'calendar_providers').del();
      await tenantTable(db, tenantId, 'schedule_entries').del();
      await tenantTable(db, tenantId, 'users').where({ user_id: userId }).del();
      await tenantRows(db, tenantId).where({ tenant: tenantId }).del();
      await db.destroy();
    }
  });

  beforeEach(async () => {
    shared.syncCalls.length = 0;
    shared.deleteCalls.length = 0;
    await tenantTable(db, tenantId, 'calendar_event_mappings').del();
    await tenantTable(db, tenantId, 'schedule_entries').del();
  });

  it('invokes outbound calendar sync when a schedule entry is saved', async () => {
    const entryData = {
      title: 'Outbound Sync Test',
      scheduled_start: new Date('2025-11-01T10:00:00Z'),
      scheduled_end: new Date('2025-11-01T11:00:00Z'),
      status: 'scheduled',
      notes: 'Generated during integration test',
      work_item_type: shared.scheduleEntryColumns.work_item_type ? 'ad_hoc' : undefined,
      assigned_user_ids: [userId],
    } as any;

    const result = await addScheduleEntry(entryData, { assignedUserIds: [userId] });
    expect(result.success).toBe(true);
    expect(result.entry).toBeDefined();

    await vi.waitFor(() => {
      expect(shared.syncCalls.length).toBeGreaterThan(0);
    });

    expect(shared.syncCalls[0]).toEqual({
      entryId: result.entry!.entry_id,
      providerId,
    });
  });

  it('fires calendar sync when a schedule entry is updated', async () => {
    const entryData = {
      title: 'Initial Entry',
      scheduled_start: new Date('2025-11-02T09:00:00Z'),
      scheduled_end: new Date('2025-11-02T10:00:00Z'),
      status: 'scheduled',
      notes: 'Initial notes',
      work_item_type: shared.scheduleEntryColumns.work_item_type ? 'ad_hoc' : undefined,
      assigned_user_ids: [userId],
    } as any;

    const createResult = await addScheduleEntry(entryData, { assignedUserIds: [userId] });
    expect(createResult.success).toBe(true);
    const entryId = createResult.entry!.entry_id;

    shared.syncCalls.length = 0;

    const updateResult = await updateScheduleEntry(entryId, {
      notes: 'Updated notes',
    });
    expect(updateResult.success).toBe(true);

    await vi.waitFor(() => {
      expect(shared.syncCalls.length).toBeGreaterThan(0);
    });

    expect(shared.syncCalls[0]).toEqual({
      entryId,
      providerId,
    });
  });

  it('calls calendar delete when a schedule entry is removed', async () => {
    const entryData = {
      title: 'Entry to Delete',
      scheduled_start: new Date('2025-11-03T12:00:00Z'),
      scheduled_end: new Date('2025-11-03T13:00:00Z'),
      status: 'scheduled',
      notes: 'To be removed',
      work_item_type: shared.scheduleEntryColumns.work_item_type ? 'ad_hoc' : undefined,
      assigned_user_ids: [userId],
    } as any;

    const createResult = await addScheduleEntry(entryData, { assignedUserIds: [userId] });
    expect(createResult.success).toBe(true);
    const entryId = createResult.entry!.entry_id;

    shared.syncCalls.length = 0;
    shared.deleteCalls.length = 0;

    const deleteResult = await deleteScheduleEntry(entryId);
    expect(deleteResult.success).toBe(true);

    await vi.waitFor(() => {
      expect(shared.deleteCalls.length).toBeGreaterThan(0);
    });

    expect(shared.deleteCalls[0]).toMatchObject({
      entryId,
      providerId,
    });

    const remaining = await tenantTable(db, tenantId, 'schedule_entries').where({ entry_id: entryId }).first();
    expect(remaining).toBeUndefined();
  });
});
