import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
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
  nextEventNumber: 1,
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
      context.providerCalls.push({ providerId: provider.id, operation: 'create', eventId, event: structuredClone(stored) });
      return structuredClone(stored);
    },
    async updateEvent(eventId: string, event: any) {
      const existing = context.providerEvents.get(key(eventId));
      if (!existing) throw Object.assign(new Error('Provider event not found'), { status: 404 });
      const stored = { ...existing, ...structuredClone(event), id: eventId, updated: new Date(Date.now() + 10_000).toISOString() };
      context.providerEvents.set(key(eventId), stored);
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

describe('Manual calendar sync integration', () => {
  const testTenant = uuidv4();
  const testUserId = uuidv4();
  const secondUserId = uuidv4();
  const thirdUserId = uuidv4();
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
    context.db = db;
    context.defaultTenant = testTenant;
    context.userId = testUserId;
    context.secondUserId = secondUserId;

    await db.migrate.latest({ directory: process.env.TEST_MIGRATIONS_DIR || 'migrations' });

    context.scheduleEntryColumns = await schemaTable(db, 'schedule_entries').columnInfo();

    await tenantRows(db, testTenant).insert({
      tenant: testTenant,
      client_name: 'Calendar Sync Tenant',
      email: 'calendar-sync@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict('tenant').ignore();

    await tenantTable(db, testTenant, 'users').insert({
      tenant: testTenant,
      user_id: testUserId,
      username: 'calendar-sync-user',
      user_type: 'internal',
      hashed_password: 'not-used',
      email: 'calendar-user@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict(['tenant', 'user_id']).ignore();
    await tenantTable(db, testTenant, 'users').insert({
      tenant: testTenant,
      user_id: thirdUserId,
      username: 'calendar-sync-third-user',
      user_type: 'internal',
      hashed_password: 'not-used',
      email: 'calendar-third-user@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict(['tenant', 'user_id']).ignore();

    await tenantTable(db, testTenant, 'users').insert({
      tenant: testTenant,
      user_id: secondUserId,
      username: 'calendar-sync-second-user',
      user_type: 'internal',
      hashed_password: 'not-used',
      email: 'calendar-second-user@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    }).onConflict(['tenant', 'user_id']).ignore();
  });

  afterAll(async () => {
    if (db) {
      await tenantTable(db, testTenant, 'calendar_event_mappings').del();
      await tenantTable(db, testTenant, 'calendar_providers').del();
      await tenantTable(db, testTenant, 'schedule_entries').del();
      await tenantTable(db, testTenant, 'calendar_shares').del();
      await tenantTable(db, testTenant, 'calendars').del();
      await tenantTable(db, testTenant, 'users').where({ user_id: testUserId }).del();
      await tenantTable(db, testTenant, 'users').where({ user_id: secondUserId }).del();
      await tenantTable(db, testTenant, 'users').where({ user_id: thirdUserId }).del();
      await tenantRows(db, testTenant).where({ tenant: testTenant }).del();
      await db.destroy();
    }
  });

  beforeEach(async () => {
    context.tenant = null;
    context.canViewAll = true;
    context.providerEvents.clear();
    context.providerCalls.length = 0;
    context.providerReadFailures.clear();
    context.nextEventNumber = 1;
    providerTenantMap.clear();

    await tenantTable(db, testTenant, 'calendar_event_mappings').del();
    await tenantTable(db, testTenant, 'calendar_providers').del();
    await tenantTable(db, testTenant, 'schedule_entries').del();
    await tenantTable(db, testTenant, 'calendar_shares').del();
    await tenantTable(db, testTenant, 'calendars').del();
  });

  function buildScheduleEntryInsert(entryId: string) {
    // The manual sync only reconciles mappings whose schedule entries fall in a
    // now-relative window (-2d..+15d), so the fixture must use relative dates.
    const now = new Date();
    const record: Record<string, any> = {
      tenant: testTenant,
      entry_id: entryId,
      title: 'Manual Sync Entry',
      scheduled_start: new Date(now.getTime() + 60 * 60 * 1000),
      scheduled_end: new Date(now.getTime() + 2 * 60 * 60 * 1000),
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

  // syncCalendarProvider now starts the sync in the background (setImmediate)
  // and returns immediately; the run finishes by moving the provider status off
  // 'disconnected' via updateProviderStatus.
  async function waitForBackgroundSync(providerId: string, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await tenantTable(db, testTenant, 'calendar_providers')
        .where({ id: providerId, tenant: testTenant })
        .first();
      if (row && row.status !== 'disconnected') {
        return row;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for background sync (status=${row?.status ?? 'missing'})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function seedBidirectionalProvider(providerType: 'google' | 'microsoft', userId = testUserId) {
    const providerId = uuidv4();
    await tenantTable(db, testTenant, 'calendar_providers').insert({
      id: providerId,
      tenant: testTenant,
      user_id: userId,
      provider_type: providerType,
      provider_name: `Manual ${providerType}`,
      calendar_id: 'primary',
      is_active: true,
      sync_direction: 'bidirectional',
      status: 'disconnected',
      last_sync_at: null,
      error_message: null,
      vendor_config: JSON.stringify({}),
      created_at: new Date(),
      updated_at: new Date(),
    });
    return providerId;
  }

  async function seedCalendarEntry(options: {
    calendarType: 'group' | 'personal';
    assignedUserIds?: string[];
    notes?: string;
  }) {
    const calendarId = uuidv4();
    await tenantTable(db, testTenant, 'calendars').insert({
      tenant: testTenant,
      calendar_id: calendarId,
      calendar_type: options.calendarType,
      owner_user_id: options.calendarType === 'personal' ? testUserId : null,
      name: options.calendarType === 'group' ? 'Operations' : null,
      is_archived: false,
      created_by: testUserId,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const entryId = uuidv4();
    const entry = buildScheduleEntryInsert(entryId);
    entry.notes = options.notes ?? 'Baseline notes';
    entry.calendar_id = calendarId;
    await tenantTable(db, testTenant, 'schedule_entries').insert(entry);
    const assignedUserIds = options.assignedUserIds ?? [testUserId];
    if (assignedUserIds.length) {
      await tenantTable(db, testTenant, 'schedule_entry_assignees').insert(
        assignedUserIds.map(userId => ({ tenant: testTenant, entry_id: entryId, user_id: userId }))
      );
    }
    return { calendarId, entryId };
  }

  async function runManualSync(providerId: string) {
    await tenantTable(db, testTenant, 'calendar_providers')
      .where({ id: providerId, tenant: testTenant }).update({ status: 'disconnected' });
    expect(await syncCalendarProvider(providerId)).toEqual({ success: true, started: true });
    return waitForBackgroundSync(providerId);
  }

  async function readMapping(providerId: string, entryId: string) {
    return tenantTable(db, testTenant, 'calendar_event_mappings')
      .where({ tenant: testTenant, calendar_provider_id: providerId, schedule_entry_id: entryId }).first();
  }

  it('pushes existing schedule entries to the external provider and updates mapping metadata', async () => {
    const providerId = uuidv4();
    const scheduleEntryId = uuidv4();
    const mappingId = uuidv4();
    const externalEventId = 'ext-manual-push';

    await tenantTable(db, testTenant, 'calendar_providers').insert({
      id: providerId,
      tenant: testTenant,
      user_id: testUserId,
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

    await tenantTable(db, testTenant, 'schedule_entries').insert(buildScheduleEntryInsert(scheduleEntryId));

    await tenantTable(db, testTenant, 'calendar_event_mappings').insert({
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
    context.providerEvents.set(`${providerId}:${externalEventId}`, {
      id: externalEventId,
      provider: 'google',
      title: 'Manual Sync Entry',
      description: 'Initial notes',
      start: { dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      end: { dateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
      status: 'confirmed',
      updated: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await syncCalendarProvider(providerId);
    expect(result).toEqual({ success: true, started: true });
    await waitForBackgroundSync(providerId);

    expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(1);
    expect(context.providerCalls.filter(call => call.operation === 'get')).toHaveLength(0);

    const updatedMapping = await tenantTable(db, testTenant, 'calendar_event_mappings')
      .where({ id: mappingId, tenant: testTenant })
      .first();

    expect(updatedMapping).toBeDefined();
    expect(updatedMapping?.sync_status).toBe('synced');
    const pushExternalLastModified =
      updatedMapping?.external_last_modified instanceof Date
        ? updatedMapping.external_last_modified.toISOString()
        : updatedMapping?.external_last_modified;
    expect(pushExternalLastModified).toBeDefined();
    expect(updatedMapping?.alga_last_modified instanceof Date).toBe(true);
    expect(updatedMapping?.sync_error_message).toBeNull();

    const providerRow = await tenantTable(db, testTenant, 'calendar_providers')
      .where({ id: providerId, tenant: testTenant })
      .first();
    expect(providerRow?.status).toBe('connected');
    expect(providerRow?.error_message).toBeNull();
    expect(providerRow?.last_sync_at).not.toBeNull();
  });

  it('pulls external changes into mapped in-window schedule entries for inbound sync', async () => {
    const providerId = uuidv4();
    const inboundEntryId = uuidv4();
    const mappingId = uuidv4();
    const externalEventId = 'ext-inbound-123';

    await tenantTable(db, testTenant, 'calendar_providers').insert({
      id: providerId,
      tenant: testTenant,
      user_id: testUserId,
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

    // Manual sync reconciles existing mapped entries only (inbound creation of
    // brand-new entries is webhook-driven now), so the local entry must exist.
    const inboundEntry = buildScheduleEntryInsert(inboundEntryId);
    inboundEntry.updated_at = new Date(Date.now() - 120_000);
    await tenantTable(db, testTenant, 'schedule_entries').insert(inboundEntry);

    await tenantTable(db, testTenant, 'calendar_event_mappings').insert({
      id: mappingId,
      tenant: testTenant,
      calendar_provider_id: providerId,
      schedule_entry_id: inboundEntryId,
      external_event_id: externalEventId,
      sync_status: 'pending',
      last_synced_at: new Date(Date.now() - 60_000),
      sync_error_message: null,
      sync_direction: 'from_external',
      alga_last_modified: inboundEntry.updated_at,
      external_last_modified: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    context.providerEvents.set(`${providerId}:${externalEventId}`, {
      id: externalEventId,
      provider: 'google',
      title: 'Manual Sync Entry',
      description: 'Updated via inbound sync',
      start: { dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      end: { dateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
      status: 'confirmed',
      updated: new Date().toISOString(),
    });

    const result = await syncCalendarProvider(providerId);
    expect(result).toEqual({ success: true, started: true });
    await waitForBackgroundSync(providerId);

    expect(context.providerCalls.filter(call => call.operation === 'get')).toHaveLength(1);

    const storedEntry = await tenantTable(db, testTenant, 'schedule_entries')
      .where({ tenant: testTenant, entry_id: inboundEntryId })
      .first();

    expect(storedEntry).toBeDefined();
    expect(storedEntry?.notes).toBe('Updated via inbound sync');
    expect(storedEntry?.status).toBe('scheduled');

    const updatedMapping = await tenantTable(db, testTenant, 'calendar_event_mappings')
      .where({ id: mappingId, tenant: testTenant })
      .first();

    expect(updatedMapping?.sync_status).toBe('synced');
    const pullExternalLastModified =
      updatedMapping?.external_last_modified instanceof Date
        ? updatedMapping.external_last_modified.toISOString()
        : updatedMapping?.external_last_modified;
    expect(pullExternalLastModified).toBeDefined();
    expect(updatedMapping?.sync_error_message).toBeNull();
  });

  it.each(['google', 'microsoft'] as const)(
    'preserves provider-authored %s notes through real bidirectional Sync Now and repeated sync', async providerType => {
      const providerId = await seedBidirectionalProvider(providerType);
      const { entryId } = await seedCalendarEntry({ calendarType: 'group', notes: 'Alga baseline' });
      await runManualSync(providerId);
      const baselineMapping = await readMapping(providerId, entryId);
      expect(baselineMapping).toBeDefined();
      const externalId = baselineMapping.external_event_id;
      const eventKey = `${providerId}:${externalId}`;
      const baselineEvent = context.providerEvents.get(eventKey);
      expect(baselineEvent.description).toContain('[Alga calendar: Operations]');
      if (providerType === 'microsoft') {
        expect(baselineEvent.categories).toEqual(['Alga calendar: Operations']);
      }

      const providerNotes = 'Notes authored in the provider';
      const editedEvent = {
        ...baselineEvent,
        description: providerType === 'microsoft'
          ? `<html><body><p>${providerNotes}</p><p>[Alga calendar: Operations]</p></body></html>`
          : `${providerNotes}\n[Alga calendar: Operations]`,
        updated: new Date(Date.now() + 60_000).toISOString(),
      };
      context.providerEvents.set(eventKey, editedEvent);

      await runManualSync(providerId);
      const storedEntry = await tenantTable(db, testTenant, 'schedule_entries')
        .where({ tenant: testTenant, entry_id: entryId }).first();
      const mappingAfterPull = await readMapping(providerId, entryId);
      expect(storedEntry.notes).toBe(providerNotes);
      expect(mappingAfterPull.id).toBe(baselineMapping.id);
      expect(mappingAfterPull.external_event_id).toBe(externalId);
      expect(context.providerEvents.get(eventKey).description).toContain('[Alga calendar: Operations]');
      expect(context.providerEvents.get(eventKey).description).toContain(providerNotes);
      if (providerType === 'microsoft') {
        expect(context.providerEvents.get(eventKey).categories).toEqual(['Alga calendar: Operations']);
      }
      expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(0);

      await runManualSync(providerId);
      expect((await tenantTable(db, testTenant, 'schedule_entries').where({ entry_id: entryId }).first()).notes)
        .toBe(providerNotes);
      expect((await readMapping(providerId, entryId)).id).toBe(baselineMapping.id);
      expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(0);
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'pushes a %s local-only edit after confirming the provider version', async providerType => {
      const providerId = await seedBidirectionalProvider(providerType);
      const { entryId } = await seedCalendarEntry({ calendarType: 'group', notes: 'Baseline' });
      await runManualSync(providerId);
      const mapping = await readMapping(providerId, entryId);
      const eventKey = `${providerId}:${mapping.external_event_id}`;
      await tenantTable(db, testTenant, 'schedule_entries').where({ entry_id: entryId }).update({
        notes: 'Local-only edit',
        updated_at: new Date(Date.now() + 30_000),
      });

      await runManualSync(providerId);
      expect(context.providerCalls.filter(call => call.operation === 'get')).toHaveLength(1);
      expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(1);
      expect(context.providerEvents.get(eventKey).description).toContain('Local-only edit');
      expect(context.providerEvents.get(eventKey).description).toContain('[Alga calendar: Operations]');
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'leaves %s simultaneous edits in conflict without a provider write', async providerType => {
      const providerId = await seedBidirectionalProvider(providerType);
      const { entryId } = await seedCalendarEntry({ calendarType: 'group', notes: 'Baseline' });
      await runManualSync(providerId);
      const mapping = await readMapping(providerId, entryId);
      const eventKey = `${providerId}:${mapping.external_event_id}`;
      await tenantTable(db, testTenant, 'schedule_entries').where({ entry_id: entryId }).update({
        notes: 'Simultaneous Alga edit',
        updated_at: new Date(Date.now() + 30_000),
      });
      context.providerEvents.set(eventKey, {
        ...context.providerEvents.get(eventKey),
        description: `Simultaneous provider edit\n[Alga calendar: Operations]`,
        updated: new Date(Date.now() + 60_000).toISOString(),
      });

      const status = await runManualSync(providerId);
      expect(status.status).toBe('error');
      expect(status.error_message).toContain('Conflict detected');
      expect((await readMapping(providerId, entryId)).sync_status).toBe('conflict');
      expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(0);
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'does not overwrite a pending %s local edit when inbound reconciliation fails', async providerType => {
      const providerId = await seedBidirectionalProvider(providerType);
      const { entryId } = await seedCalendarEntry({ calendarType: 'group', notes: 'Baseline' });
      await runManualSync(providerId);
      const mapping = await readMapping(providerId, entryId);
      await tenantTable(db, testTenant, 'schedule_entries').where({ entry_id: entryId }).update({
        notes: 'Pending local edit',
        updated_at: new Date(Date.now() + 30_000),
      });
      context.providerReadFailures.set(providerId, new Error('synthetic provider read failure'));

      const status = await runManualSync(providerId);
      expect(status.status).toBe('error');
      expect(status.error_message).toContain('synthetic provider read failure');
      expect((await tenantTable(db, testTenant, 'schedule_entries').where({ entry_id: entryId }).first()).notes)
        .toBe('Pending local edit');
      expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(0);
      expect((await readMapping(providerId, entryId)).external_event_id).toBe(mapping.external_event_id);
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'uses non-admin read-only group access for %s marker echoes and performs one corrective write for a real edit', async providerType => {
      context.canViewAll = false;
      const providerId = await seedBidirectionalProvider(providerType);
      const { calendarId, entryId } = await seedCalendarEntry({
        calendarType: 'group',
        assignedUserIds: [context.secondUserId!, thirdUserId],
        notes: 'Shared notes',
      });
      await tenantTable(db, testTenant, 'calendar_shares').insert({
        tenant: testTenant,
        calendar_id: calendarId,
        grantee_type: 'user',
        grantee_id: testUserId,
        access_level: 'read',
        created_by: testUserId,
      });
      await runManualSync(providerId);
      const mapping = await readMapping(providerId, entryId);
      const eventKey = `${providerId}:${mapping.external_event_id}`;
      const baseline = context.providerEvents.get(eventKey);
      expect(baseline.description).toContain('[Alga calendar: Operations]');
      expect(context.canViewAll).toBe(false);

      context.providerEvents.set(eventKey, {
        ...baseline,
        ...(providerType === 'microsoft'
          ? { categories: [...(baseline.categories ?? []), 'Provider category echo'] }
          : {}),
        updated: new Date(Date.now() + 30_000).toISOString(),
      });
      await runManualSync(providerId);
      expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(0);
      expect((await tenantTable(db, testTenant, 'schedule_entries').where({ entry_id: entryId }).first()).notes)
        .toBe('Shared notes');

      const echoed = context.providerEvents.get(eventKey);
      context.providerEvents.set(eventKey, {
        ...echoed,
        title: 'Unauthorized provider title edit',
        updated: new Date(Date.now() + 60_000).toISOString(),
      });
      await runManualSync(providerId);
      expect(context.providerCalls.filter(call => call.operation === 'update')).toHaveLength(1);
      expect(context.providerEvents.get(eventKey).title).toBe('Manual Sync Entry');
      expect((await tenantTable(db, testTenant, 'schedule_entries').where({ entry_id: entryId }).first()).notes)
        .toBe('Shared notes');
    }
  );

  it.each(['google', 'microsoft'] as const)(
    'preserves user-authored marker-like notes on a non-null personal calendar_id for %s outbound and inbound sync', async providerType => {
      const providerId = await seedBidirectionalProvider(providerType);
      const userNote = 'Personal [Alga calendar: authored by the user]';
      const { calendarId, entryId } = await seedCalendarEntry({
        calendarType: 'personal', notes: userNote,
      });
      expect(calendarId).toBeTruthy();
      await runManualSync(providerId);
      const mapping = await readMapping(providerId, entryId);
      const eventKey = `${providerId}:${mapping.external_event_id}`;
      const outbound = context.providerEvents.get(eventKey);
      expect(outbound.description).toBe(userNote);
      expect(outbound.categories).toBeUndefined();
      expect(outbound.extendedProperties?.private).not.toHaveProperty('alga-calendar-marker-name');

      const providerAuthoredNote = 'Provider personal [Alga calendar: keep this literal]';
      context.providerEvents.set(eventKey, {
        ...outbound,
        description: providerAuthoredNote,
        updated: new Date(Date.now() + 30_000).toISOString(),
      });
      await runManualSync(providerId);
      const storedEntry = await tenantTable(db, testTenant, 'schedule_entries')
        .where({ entry_id: entryId }).first();
      expect(storedEntry.calendar_id).toBe(calendarId);
      expect(storedEntry.notes).toBe(providerAuthoredNote);
      expect(context.providerEvents.get(eventKey).description).toBe(providerAuthoredNote);
      expect((await readMapping(providerId, entryId)).id).toBe(mapping.id);
    }
  );
});
