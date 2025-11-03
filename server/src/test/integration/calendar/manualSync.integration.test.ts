import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';

const modulePaths = vi.hoisted(() => {
  const calendarActionsModuleUrl = new URL('../../../lib/actions/calendarActions.ts', import.meta.url);
  const libDbModulePath = new URL('../../lib/db/index.tsx', calendarActionsModuleUrl).pathname;
  const rootDbModulePath = new URL('../../db.ts', calendarActionsModuleUrl).pathname;
  const userActionsModulePath = new URL('../../../lib/actions/user-actions/userActions.ts', import.meta.url).pathname;
  const rbacModulePath = new URL('../../../lib/auth/rbac.ts', import.meta.url).pathname;

  return {
    libDbModulePath,
    libDbModulePathNoExt: libDbModulePath.replace(/\.tsx$/, ''),
    rootDbModulePath,
    rootDbModulePathNoExt: rootDbModulePath.replace(/\.ts$/, ''),
    userActionsModulePath,
    userActionsModulePathNoExt: userActionsModulePath.replace(/\.ts$/, ''),
    rbacModulePath,
    rbacModulePathNoExt: rbacModulePath.replace(/\.ts$/, ''),
  };
});

const context = vi.hoisted(() => ({
  db: null as Knex | null,
  tenant: null as string | null,
  defaultTenant: null as string | null,
  userId: null as string | null,
  scheduleEntryColumns: {} as Record<string, { nullable: boolean }>,
  lastPushMetadata: null as {
    entryId: string;
    providerId: string;
    lastSyncedAt: Date;
    algaLastModified: Date;
    externalLastModified: string;
  } | null,
  lastPullMetadata: null as {
    externalEventId: string;
    providerId: string;
    created: boolean;
    externalLastModified: string;
  } | null,
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

const providerTenantMap = vi.hoisted(() => new Map<string, string>());

vi.mock('@/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProvider(providerId: string, tenant: string) {
      if (!context.db) {
        throw new Error('Database not initialized');
      }
      const row = await context.db('calendar_providers')
        .where({ id: providerId, tenant })
        .first();
      if (!row) {
        return null;
      }
      providerTenantMap.set(providerId, row.tenant);
      return {
        id: row.id,
        tenant: row.tenant,
        name: row.provider_name,
        provider_type: row.provider_type,
        calendar_id: row.calendar_id,
        sync_direction: row.sync_direction,
        status: row.status,
        last_sync_at: row.last_sync_at,
        error_message: row.error_message,
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
      await context.db('calendar_providers')
        .where({ id: providerId, tenant })
        .update({
          status: updates.status,
          error_message: updates.errorMessage ?? null,
          last_sync_at: updates.lastSyncAt ? new Date(updates.lastSyncAt) : null,
          updated_at: new Date(),
        });
    }
  },
}));

vi.mock('@/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: class {
    async syncScheduleEntryToExternal(entryId: string, providerId: string) {
      if (!context.db) {
        throw new Error('Database not initialized');
      }
      const tenant = context.tenant ?? context.defaultTenant;
      if (!tenant) {
        throw new Error('Tenant context missing');
      }

      const mapping = await context.db('calendar_event_mappings')
        .where({
          tenant,
          calendar_provider_id: providerId,
          schedule_entry_id: entryId,
        })
        .first();

      if (!mapping) {
        return { success: false, error: 'Mapping not found' };
      }

      const algaLastModified = new Date('2025-10-31T10:00:00.000Z');
      const lastSyncedAt = new Date('2025-10-31T11:05:00.000Z');
      const externalLastModified = '2025-10-31T11:00:00.000Z';

      await context.db('calendar_event_mappings')
        .where({ id: mapping.id, tenant })
        .update({
          sync_status: 'synced',
          last_synced_at: lastSyncedAt,
          alga_last_modified: algaLastModified,
          external_last_modified: externalLastModified,
          sync_error_message: null,
          updated_at: lastSyncedAt,
        });

      context.lastPushMetadata = {
        entryId,
        providerId,
        lastSyncedAt,
        algaLastModified,
        externalLastModified,
      };

      return {
        success: true,
        externalEventId: mapping.external_event_id,
      };
    }

    async syncExternalEventToSchedule(externalEventId: string, providerId: string) {
      if (!context.db) {
        throw new Error('Database not initialized');
      }
      const tenant = context.tenant ?? context.defaultTenant;
      if (!tenant) {
        throw new Error('Tenant context missing');
      }

      const mapping = await context.db('calendar_event_mappings')
        .where({
          tenant,
          calendar_provider_id: providerId,
          external_event_id: externalEventId,
        })
        .first();

      if (!mapping) {
        return { success: false, error: 'Mapping not found' };
      }

      const columns = context.scheduleEntryColumns;
      const existing = await context.db('schedule_entries')
        .where({ tenant, entry_id: mapping.schedule_entry_id })
        .first();

      const now = new Date('2025-10-31T12:15:00.000Z');

      if (!existing) {
        const insertRecord: Record<string, any> = {
          tenant,
          entry_id: mapping.schedule_entry_id,
          title: 'Inbound Meeting',
          scheduled_start: new Date('2025-10-31T12:00:00.000Z'),
          scheduled_end: new Date('2025-10-31T13:00:00.000Z'),
          status: 'scheduled',
          notes: 'Created via inbound sync',
          work_item_type: columns.work_item_type ? 'ad_hoc' : 'ticket',
          created_at: now,
          updated_at: now,
        };

        if (columns.work_item_id) {
          insertRecord.work_item_id = uuidv4();
        }
        if (columns.user_id) {
          insertRecord.user_id = context.userId;
        }
        if (columns.is_private) {
          insertRecord.is_private = false;
        }
        if (columns.is_recurring) {
          insertRecord.is_recurring = false;
        }
        if (columns.recurrence_pattern) {
          insertRecord.recurrence_pattern = null;
        }
        if (columns.original_entry_id) {
          insertRecord.original_entry_id = null;
        }
        if (columns.duration_minutes) {
          insertRecord.duration_minutes = 60;
        }

        await context.db('schedule_entries').insert(insertRecord);
        context.lastPullMetadata = {
          externalEventId,
          providerId,
          created: true,
          externalLastModified: '2025-10-31T12:05:00.000Z',
        };
      } else {
        await context.db('schedule_entries')
          .where({ tenant, entry_id: mapping.schedule_entry_id })
          .update({
            notes: 'Updated via inbound sync',
            updated_at: now,
          });
        context.lastPullMetadata = {
          externalEventId,
          providerId,
          created: false,
          externalLastModified: '2025-10-31T12:05:00.000Z',
        };
      }

      await context.db('calendar_event_mappings')
        .where({ id: mapping.id, tenant })
        .update({
          sync_status: 'synced',
          last_synced_at: now,
          alga_last_modified: now,
          external_last_modified: '2025-10-31T12:05:00.000Z',
          sync_error_message: null,
          updated_at: now,
        });

      return {
        success: true,
        scheduleEntryId: mapping.schedule_entry_id,
      };
    }
  },
}));

vi.mock(modulePaths.userActionsModulePath, () => ({
  getCurrentUser: vi.fn(async () => ({
    tenant: context.defaultTenant,
    user_id: context.userId,
  })),
}));
vi.mock(modulePaths.userActionsModulePathNoExt, () => ({
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

vi.mock('@/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
}));

import { syncCalendarProvider } from '../../../lib/actions/calendarActions';

describe('Manual calendar sync integration', () => {
  const testTenant = uuidv4();
  const testUserId = uuidv4();
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    context.db = db;
    context.defaultTenant = testTenant;
    context.userId = testUserId;

    await db.migrate.latest();

    context.scheduleEntryColumns = await db('schedule_entries').columnInfo();

    await db('tenants').insert({
      tenant: testTenant,
      client_name: 'Calendar Sync Tenant',
      email: 'calendar-sync@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict('tenant').ignore();

    await db('users').insert({
      tenant: testTenant,
      user_id: testUserId,
      username: 'calendar-sync-user',
      hashed_password: 'not-used',
      email: 'calendar-user@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict(['tenant', 'user_id']).ignore();
  });

  afterAll(async () => {
    if (db) {
      await db('calendar_event_mappings').where({ tenant: testTenant }).del();
      await db('calendar_providers').where({ tenant: testTenant }).del();
      await db('schedule_entries').where({ tenant: testTenant }).del();
      await db('users').where({ tenant: testTenant, user_id: testUserId }).del();
      await db('tenants').where({ tenant: testTenant }).del();
      await db.destroy();
    }
  });

  beforeEach(async () => {
    context.tenant = null;
    context.lastPushMetadata = null;
    context.lastPullMetadata = null;
    providerTenantMap.clear();

    await db('calendar_event_mappings').where({ tenant: testTenant }).del();
    await db('calendar_providers').where({ tenant: testTenant }).del();
    await db('schedule_entries').where({ tenant: testTenant }).del();
  });

  function buildScheduleEntryInsert(entryId: string) {
    const now = new Date('2025-10-31T08:00:00.000Z');
    const record: Record<string, any> = {
      tenant: testTenant,
      entry_id: entryId,
      title: 'Manual Sync Entry',
      scheduled_start: now,
      scheduled_end: new Date('2025-10-31T09:00:00.000Z'),
      status: 'scheduled',
      notes: 'Initial notes',
      created_at: now,
      updated_at: now,
    };
    if (context.scheduleEntryColumns.work_item_type) {
      record.work_item_type = 'ad_hoc';
    }
    if (context.scheduleEntryColumns.work_item_id) {
      record.work_item_id = uuidv4();
    }
    if (context.scheduleEntryColumns.user_id) {
      record.user_id = testUserId;
    }
    if (context.scheduleEntryColumns.is_private) {
      record.is_private = false;
    }
    if (context.scheduleEntryColumns.is_recurring) {
      record.is_recurring = false;
    }
    if (context.scheduleEntryColumns.recurrence_pattern) {
      record.recurrence_pattern = null;
    }
    if (context.scheduleEntryColumns.original_entry_id) {
      record.original_entry_id = null;
    }
    if (context.scheduleEntryColumns.duration_minutes) {
      record.duration_minutes = 60;
    }
    return record;
  }

  it('pushes existing schedule entries to the external provider and updates mapping metadata', async () => {
    const providerId = uuidv4();
    const scheduleEntryId = uuidv4();
    const mappingId = uuidv4();
    const externalEventId = 'ext-manual-push';

    await db('calendar_providers').insert({
      id: providerId,
      tenant: testTenant,
      provider_type: 'google',
      provider_name: 'Manual Sync Provider',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'to_external',
      status: 'disconnected',
      last_sync_at: null,
      error_message: null,
      vendor_config: JSON.stringify({}),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db('schedule_entries').insert(buildScheduleEntryInsert(scheduleEntryId));

    await db('calendar_event_mappings').insert({
      id: mappingId,
      tenant: testTenant,
      calendar_provider_id: providerId,
      schedule_entry_id: scheduleEntryId,
      external_event_id: externalEventId,
      sync_status: 'pending',
      last_synced_at: null,
      sync_error_message: null,
      sync_direction: 'to_external',
      alga_last_modified: null,
      external_last_modified: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const result = await syncCalendarProvider(providerId);
    expect(result).toEqual({ success: true });

    expect(context.lastPushMetadata).not.toBeNull();
    expect(context.lastPushMetadata?.entryId).toBe(scheduleEntryId);
    expect(context.lastPushMetadata?.providerId).toBe(providerId);

    const updatedMapping = await db('calendar_event_mappings')
      .where({ id: mappingId, tenant: testTenant })
      .first();

    expect(updatedMapping).toBeDefined();
    expect(updatedMapping?.sync_status).toBe('synced');
    expect(context.lastPushMetadata).not.toBeNull();
    const pushExternalLastModified =
      updatedMapping?.external_last_modified instanceof Date
        ? updatedMapping.external_last_modified.toISOString()
        : updatedMapping?.external_last_modified;
    expect(pushExternalLastModified).toBe(context.lastPushMetadata?.externalLastModified);
    expect(updatedMapping?.alga_last_modified instanceof Date).toBe(true);
    expect(updatedMapping?.sync_error_message).toBeNull();

    const providerRow = await db('calendar_providers')
      .where({ id: providerId, tenant: testTenant })
      .first();
    expect(providerRow?.status).toBe('connected');
    expect(providerRow?.error_message).toBeNull();
    expect(providerRow?.last_sync_at).not.toBeNull();
  });

  it('pulls external changes and persists schedule entries for inbound sync', async () => {
    const providerId = uuidv4();
    const inboundEntryId = uuidv4();
    const mappingId = uuidv4();
    const externalEventId = 'ext-inbound-123';

    await db('calendar_providers').insert({
      id: providerId,
      tenant: testTenant,
      provider_type: 'google',
      provider_name: 'Inbound Provider',
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'from_external',
      status: 'disconnected',
      last_sync_at: null,
      error_message: null,
      vendor_config: JSON.stringify({}),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db('calendar_event_mappings').insert({
      id: mappingId,
      tenant: testTenant,
      calendar_provider_id: providerId,
      schedule_entry_id: inboundEntryId,
      external_event_id: externalEventId,
      sync_status: 'pending',
      last_synced_at: null,
      sync_error_message: null,
      sync_direction: 'from_external',
      alga_last_modified: null,
      external_last_modified: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const result = await syncCalendarProvider(providerId);
    expect(result).toEqual({ success: true });
    expect(context.lastPullMetadata).not.toBeNull();
    expect(context.lastPullMetadata?.externalEventId).toBe(externalEventId);
    expect(context.lastPullMetadata?.created).toBe(true);

    const storedEntry = await db('schedule_entries')
      .where({ tenant: testTenant, entry_id: inboundEntryId })
      .first();

    expect(storedEntry).toBeDefined();
    expect(storedEntry?.notes).toBe('Created via inbound sync');
    expect(storedEntry?.status).toBe('scheduled');

    const updatedMapping = await db('calendar_event_mappings')
      .where({ id: mappingId, tenant: testTenant })
      .first();

    expect(updatedMapping?.sync_status).toBe('synced');
    const pullExternalLastModified =
      updatedMapping?.external_last_modified instanceof Date
        ? updatedMapping.external_last_modified.toISOString()
        : updatedMapping?.external_last_modified;
    expect(pullExternalLastModified).toBe(context.lastPullMetadata?.externalLastModified);
    expect(updatedMapping?.sync_error_message).toBeNull();
  });
});
