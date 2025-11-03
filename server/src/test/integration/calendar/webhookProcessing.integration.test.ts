import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import { CalendarWebhookProcessor } from '../../../services/calendar/CalendarWebhookProcessor';

function mergeProviderConfig(target: any, overrides?: Record<string, unknown>) {
  if (!overrides) {
    return target;
  }
  return {
    ...target,
    ...overrides,
    provider_config: {
      ...(target.provider_config || {}),
      ...(overrides.provider_config || {}),
    },
  };
}

const shared = vi.hoisted(() => ({
  db: null as Knex | null,
  trx: null as Knex.Transaction | null,
  defaultTenant: '' as string,
  activeTenant: '' as string,
  syncCalls: [] as Array<{ externalEventId: string; providerId: string }>,
  deleteCalls: [] as Array<{ entryId: string; providerId: string; scope: string }>,
}));

function buildDbExports() {
  return {
    createTenantKnex: async () => {
      if (!shared.db) {
        throw new Error('[webhookProcessing.integration] Database not initialized');
      }
      return {
        knex: shared.trx ?? shared.db,
        tenant: shared.activeTenant || shared.defaultTenant,
      };
    },
    runWithTenant: async (tenant: string, cb: () => Promise<any>) => {
      const previous = shared.activeTenant;
      shared.activeTenant = tenant;
      try {
        return await cb();
      } finally {
        shared.activeTenant = previous;
      }
    },
    getTenantContext: async () => shared.activeTenant || shared.defaultTenant,
    getCurrentTenantId: async () => shared.activeTenant || shared.defaultTenant,
  };
}

vi.mock('../../../lib/db/index.tsx', () => buildDbExports());
vi.mock('../../../db.ts', () => buildDbExports());

describe('Calendar webhook processing', () => {
  const tenantId = uuidv4();
  let db: Knex;

  const getActiveDb = () => {
    const connection = shared.trx ?? shared.db;
    if (!connection) {
      throw new Error('Test database not initialized');
    }
    return connection;
  };

  const buildMicrosoftProvider = (overrides?: Record<string, unknown>) => {
    const baseProvider = {
      id: uuidv4(),
      tenant: tenantId,
      provider_type: 'microsoft' as const,
      provider_config: {
        deltaLink: null,
        webhookVerificationToken: 'verify-token',
      },
      sync_direction: 'bidirectional' as const,
      status: 'connected',
      last_sync_at: null,
    };
    return mergeProviderConfig(baseProvider, overrides);
  };

  beforeAll(async () => {
    db = await createTestDbConnection();
    shared.db = db;
    shared.defaultTenant = tenantId;
    await db.migrate.latest();

    await db('tenants')
      .insert({
        tenant: tenantId,
        client_name: 'Webhook Tenant',
        email: 'webhook@example.com',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict('tenant')
      .ignore();
  });

  afterAll(async () => {
    if (db) {
      await db('calendar_event_mappings').where({ tenant: tenantId }).del();
      await db('tenants').where({ tenant: tenantId }).del();
      await db.destroy();
    }
  });

  beforeEach(async () => {
    shared.syncCalls.length = 0;
    shared.deleteCalls.length = 0;
    shared.activeTenant = '';
    shared.trx = await db.transaction();
    await getActiveDb()('calendar_event_mappings').where({ tenant: tenantId }).del();
  });

  afterEach(async () => {
    if (shared.trx) {
      await shared.trx.rollback().catch(() => undefined);
      shared.trx = null;
    }
  });

  it('processes Google webhook updates by calling syncExternalEventToSchedule', async () => {
    const providerId = uuidv4();
    const provider = {
      id: providerId,
      tenant: tenantId,
      provider_type: 'google' as const,
      provider_config: { syncToken: 'initial-token' },
      sync_direction: 'bidirectional' as const,
      status: 'connected',
      last_sync_at: null,
    };

    const googleChanges = {
      changes: [{ id: 'google-event-1', changeType: 'updated' as const }],
      nextSyncToken: 'next-token',
      resetRequired: false,
    };

    const googleAdapter = {
      connect: vi.fn(async () => {}),
      fetchEventChanges: vi.fn(async () => googleChanges),
    };

    const processor = new CalendarWebhookProcessor();

    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async (externalEventId: string, providerIdArg: string) => {
        shared.syncCalls.push({ externalEventId, providerId: providerIdArg });
        return { success: true, scheduleEntryId: `schedule-${externalEventId}` };
      }),
      deleteScheduleEntry: vi.fn(async () => ({ success: true })),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async (_id: string, _tenant: string, data: { vendorConfig?: Record<string, any> }) => {
        if (data.vendorConfig) {
          provider.provider_config = {
            ...provider.provider_config,
            ...data.vendorConfig,
          };
        }
      }),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByGoogleSubscription').mockResolvedValue(provider);
    vi.spyOn(processor as any, 'createAdapter').mockImplementation(async (prov: typeof provider) => {
      if (prov.provider_type !== 'google') {
        throw new Error('Unexpected provider type');
      }
      return googleAdapter as any;
    });

    const outcome = await processor.processGoogleWebhook({ data: 'ignored' }, 'subscription-1');

    expect(outcome).toEqual({ success: 1, failed: 0 });
    expect(shared.syncCalls).toContainEqual({ externalEventId: 'google-event-1', providerId });
    expect(provider.provider_config.syncToken).toBe('next-token');
  });

  it('processes Google webhook deletions by calling deleteScheduleEntry', async () => {
    const providerId = uuidv4();
    const scheduleEntryId = uuidv4();
    const provider = {
      id: providerId,
      tenant: tenantId,
      provider_type: 'google' as const,
      provider_config: {},
      sync_direction: 'bidirectional' as const,
      status: 'connected',
      last_sync_at: null,
    };

    await getActiveDb()('calendar_event_mappings').insert({
      id: uuidv4(),
      tenant: tenantId,
      calendar_provider_id: providerId,
      schedule_entry_id: scheduleEntryId,
      external_event_id: 'google-delete',
      sync_status: 'synced',
      last_synced_at: new Date(),
      sync_error_message: null,
      sync_direction: 'from_external',
      alga_last_modified: new Date(),
      external_last_modified: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    const googleChanges = {
      changes: [{ id: 'google-delete', changeType: 'deleted' as const }],
      nextSyncToken: undefined,
      resetRequired: false,
    };

    const googleAdapter = {
      connect: vi.fn(async () => {}),
      fetchEventChanges: vi.fn(async () => googleChanges),
    };

    const processor = new CalendarWebhookProcessor();

    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async () => ({ success: true })),
      deleteScheduleEntry: vi.fn(async (entryId: string, providerIdArg: string, scope: string) => {
        shared.deleteCalls.push({ entryId, providerId: providerIdArg, scope });
        return { success: true };
      }),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async () => {}),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByGoogleSubscription').mockResolvedValue(provider);
    vi.spyOn(processor as any, 'createAdapter').mockImplementation(async (prov: typeof provider) => {
      if (prov.provider_type !== 'google') {
        throw new Error('Unexpected provider type');
      }
      return googleAdapter as any;
    });

    const outcome = await processor.processGoogleWebhook({ data: 'ignored' }, 'subscription-delete');

    expect(outcome).toEqual({ success: 1, failed: 0 });
    expect(shared.deleteCalls).toContainEqual({ entryId: scheduleEntryId, providerId, scope: 'all' });
  });

  it('processes Microsoft webhook updates using delta changes', async () => {
    const providerId = uuidv4();
    const provider = {
      id: providerId,
      tenant: tenantId,
      provider_type: 'microsoft' as const,
      provider_config: { deltaLink: 'initial-delta', webhookVerificationToken: 'verify-token' },
      sync_direction: 'bidirectional' as const,
      status: 'connected',
      last_sync_at: null,
    };

    const microsoftChanges = {
      changes: [{ id: 'ms-event-1', changeType: 'updated' as const }],
      deltaLink: 'next-delta',
      resetRequired: false,
    };

    const microsoftAdapter = {
      connect: vi.fn(async () => {}),
      fetchDeltaChanges: vi.fn(async () => microsoftChanges),
    };

    const processor = new CalendarWebhookProcessor();

    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async (externalEventId: string, providerIdArg: string) => {
        shared.syncCalls.push({ externalEventId, providerId: providerIdArg });
        return { success: true, scheduleEntryId: `schedule-${externalEventId}` };
      }),
      deleteScheduleEntry: vi.fn(async () => ({ success: true })),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async (_id: string, _tenant: string, data: { vendorConfig?: Record<string, any> }) => {
        if (data.vendorConfig) {
          provider.provider_config = {
            ...provider.provider_config,
            ...data.vendorConfig,
          };
        }
      }),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByMicrosoftSubscription').mockResolvedValue(provider);
    vi.spyOn(processor as any, 'createAdapter').mockImplementation(async (prov: typeof provider) => {
      if (prov.provider_type !== 'microsoft') {
        throw new Error('Unexpected provider type');
      }
      return microsoftAdapter as any;
    });

    const notifications = [
      {
        subscriptionId: 'subscription-ms',
        clientState: 'verify-token',
        changeType: 'updated',
        resourceData: { id: 'ms-event-1' },
      },
    ];

    const outcome = await processor.processMicrosoftWebhook(notifications);

    expect(outcome).toEqual({ success: 1, failed: 0 });
    expect(shared.syncCalls).toContainEqual({ externalEventId: 'ms-event-1', providerId });
    expect(provider.provider_config.deltaLink).toBe('next-delta');
  });

  it('processes Microsoft webhook deletions by calling deleteScheduleEntry', async () => {
    const providerId = uuidv4();
    const scheduleEntryId = uuidv4();
    const provider = {
      id: providerId,
      tenant: tenantId,
      provider_type: 'microsoft' as const,
      provider_config: { deltaLink: null, webhookVerificationToken: 'verify-token' },
      sync_direction: 'bidirectional' as const,
      status: 'connected',
      last_sync_at: null,
    };

    await getActiveDb()('calendar_event_mappings').insert({
      id: uuidv4(),
      tenant: tenantId,
      calendar_provider_id: providerId,
      schedule_entry_id: scheduleEntryId,
      external_event_id: 'ms-delete',
      sync_status: 'synced',
      last_synced_at: new Date(),
      sync_error_message: null,
      sync_direction: 'from_external',
      alga_last_modified: new Date(),
      external_last_modified: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    const microsoftChanges = {
      changes: [{ id: 'ms-delete', changeType: 'deleted' as const }],
      deltaLink: 'delta-after-delete',
      resetRequired: false,
    };

    const microsoftAdapter = {
      connect: vi.fn(async () => {}),
      fetchDeltaChanges: vi.fn(async () => microsoftChanges),
    };

    const processor = new CalendarWebhookProcessor();

    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async () => ({ success: true })),
      deleteScheduleEntry: vi.fn(async (entryId: string, providerIdArg: string, scope: string) => {
        shared.deleteCalls.push({ entryId, providerId: providerIdArg, scope });
        return { success: true };
      }),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async () => {}),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByMicrosoftSubscription').mockResolvedValue(provider);
    vi.spyOn(processor as any, 'createAdapter').mockImplementation(async (prov: typeof provider) => {
      if (prov.provider_type !== 'microsoft') {
        throw new Error('Unexpected provider type');
      }
      return microsoftAdapter as any;
    });

    const notifications = [
      {
        subscriptionId: 'subscription-ms-del',
        clientState: 'verify-token',
        changeType: 'deleted',
        resourceData: { id: 'ms-delete' },
      },
    ];

    const outcome = await processor.processMicrosoftWebhook(notifications);

    expect(outcome).toEqual({ success: 1, failed: 0 });
    expect(shared.deleteCalls).toContainEqual({ entryId: scheduleEntryId, providerId, scope: 'all' });
  });

  it('dedupes recurring Microsoft updates, deletions, and notification fallbacks', async () => {
    const provider = buildMicrosoftProvider({
      provider_config: {
        deltaLink: 'delta-prev',
      },
    });

    const masterId = 'series-master';
    const occurrenceId = 'series-master_occurrence-2025-11-02T12:00:00Z';
    const exceptionId = 'series-master_exception-2025-11-04T09:00:00Z';
    const deletedId = 'series-master_deleted-2025-11-05T09:00:00Z';
    const attendeeShiftId = 'series-master_attendee-update';

    const scheduleEntryDeleted = uuidv4();
    await getActiveDb()('calendar_event_mappings').insert({
      id: uuidv4(),
      tenant: tenantId,
      calendar_provider_id: provider.id,
      schedule_entry_id: scheduleEntryDeleted,
      external_event_id: deletedId,
      sync_status: 'synced',
      last_synced_at: new Date(),
      sync_direction: 'from_external',
      alga_last_modified: new Date(),
      external_last_modified: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    const microsoftAdapter = {
      connect: vi.fn(async () => {}),
      fetchDeltaChanges: vi.fn(async () => ({
        changes: [
          { id: masterId, changeType: 'updated' as const },
          { id: occurrenceId, changeType: 'updated' as const },
          { id: occurrenceId, changeType: 'updated' as const },
          { id: exceptionId, changeType: 'updated' as const },
          { id: deletedId, changeType: 'deleted' as const },
        ],
        deltaLink: 'delta-next',
        resetRequired: false,
      })),
    };

    const processor = new CalendarWebhookProcessor();
    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async (externalEventId: string, providerIdArg: string) => {
        shared.syncCalls.push({ externalEventId, providerId: providerIdArg });
        return { success: true };
      }),
      deleteScheduleEntry: vi.fn(async (entryId: string, providerIdArg: string, scope: string) => {
        shared.deleteCalls.push({ entryId, providerId: providerIdArg, scope });
        return { success: true };
      }),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async (_id: string, _tenant: string, data: { vendorConfig?: Record<string, any> }) => {
        if (data.vendorConfig) {
          provider.provider_config = {
            ...provider.provider_config,
            ...data.vendorConfig,
          };
        }
      }),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByMicrosoftSubscription').mockResolvedValue(provider);
    vi.spyOn(processor as any, 'createAdapter').mockImplementation(async (prov: typeof provider) => {
      if (prov.provider_type !== 'microsoft') {
        throw new Error('Unexpected provider type');
      }
      return microsoftAdapter as any;
    });

    const notifications = [
      {
        subscriptionId: 'subscription-series',
        clientState: 'verify-token',
        changeType: 'updated',
        resourceData: { id: masterId },
      },
      {
        subscriptionId: 'subscription-series',
        clientState: 'verify-token',
        changeType: 'deleted',
        resource: `Users/47c4522c-f868/events/${deletedId}`,
      },
      {
        subscriptionId: 'subscription-series',
        clientState: 'verify-token',
        changeType: 'updated',
        resource: `Users/47c4522c-f868/events/${attendeeShiftId}`,
      },
    ];

    const outcome = await processor.processMicrosoftWebhook(notifications);

    expect(outcome).toEqual({ success: 5, failed: 0 });
    expect(shared.syncCalls.map(call => call.externalEventId)).toEqual([
      masterId,
      occurrenceId,
      exceptionId,
      attendeeShiftId,
    ]);
    expect(shared.deleteCalls).toContainEqual({ entryId: scheduleEntryDeleted, providerId: provider.id, scope: 'all' });
    expect(provider.provider_config.deltaLink).toBe('delta-next');
    expect(syncServiceStub.syncExternalEventToSchedule).toHaveBeenCalledTimes(4);
    expect(syncServiceStub.deleteScheduleEntry).toHaveBeenCalledTimes(1);
  });

  it('counts Microsoft notifications with invalid client state as failures', async () => {
    const provider = buildMicrosoftProvider();

    const microsoftAdapter = {
      connect: vi.fn(async () => {}),
      fetchDeltaChanges: vi.fn(async () => ({
        changes: [],
        deltaLink: provider.provider_config?.deltaLink,
        resetRequired: false,
      })),
    };

    const processor = new CalendarWebhookProcessor();
    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async () => ({ success: true })),
      deleteScheduleEntry: vi.fn(async () => ({ success: true })),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async () => {}),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByMicrosoftSubscription').mockResolvedValue(provider);
    vi.spyOn(processor as any, 'createAdapter').mockResolvedValue(microsoftAdapter as any);

    const notifications = [
      {
        subscriptionId: 'subscription-series',
        clientState: 'wrong-token',
        changeType: 'updated',
        resourceData: { id: 'ignored-event' },
      },
    ];

    const outcome = await processor.processMicrosoftWebhook(notifications);

    expect(outcome).toEqual({ success: 0, failed: 1 });
    expect(syncServiceStub.syncExternalEventToSchedule).not.toHaveBeenCalled();
    expect(syncServiceStub.deleteScheduleEntry).not.toHaveBeenCalled();
  });

  it('resets Microsoft delta link when invalid and replays changes', async () => {
    const provider = buildMicrosoftProvider({
      provider_config: {
        deltaLink: 'stale-delta',
      },
    });

    const firstResponse = { changes: [], resetRequired: true as const };
    const secondResponse = {
      changes: [{ id: 'reset-event', changeType: 'updated' as const }],
      deltaLink: 'fresh-delta',
      resetRequired: false,
    };

    const fetchDeltaChangesMock = vi.fn(async (delta?: string | null) => {
      if (delta) {
        return firstResponse;
      }
      return secondResponse;
    });

    const microsoftAdapter = {
      connect: vi.fn(async () => {}),
      fetchDeltaChanges: fetchDeltaChangesMock,
    };

    const processor = new CalendarWebhookProcessor();
    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async (externalEventId: string, providerIdArg: string) => {
        shared.syncCalls.push({ externalEventId, providerId: providerIdArg });
        return { success: true };
      }),
      deleteScheduleEntry: vi.fn(async () => ({ success: true })),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async (_id: string, _tenant: string, data: { vendorConfig?: Record<string, any> }) => {
        if (data.vendorConfig) {
          provider.provider_config = {
            ...provider.provider_config,
            ...data.vendorConfig,
          };
        }
      }),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByMicrosoftSubscription').mockResolvedValue(provider);
    const deltaSpy = vi.spyOn(processor as any, 'createAdapter').mockResolvedValue(microsoftAdapter as any);

    const notifications = [
      {
        subscriptionId: 'subscription-series',
        clientState: 'verify-token',
        changeType: 'updated',
        resourceData: { id: 'reset-event' },
      },
    ];

    const outcome = await processor.processMicrosoftWebhook(notifications);

    expect(outcome).toEqual({ success: 1, failed: 0 });
    expect(shared.syncCalls.map(call => call.externalEventId)).toEqual(['reset-event']);

    expect(providerServiceStub.updateProvider).toHaveBeenCalledWith(
      provider.id,
      provider.tenant,
      expect.objectContaining({ vendorConfig: { deltaLink: null } })
    );
    expect(providerServiceStub.updateProvider).toHaveBeenCalledWith(
      provider.id,
      provider.tenant,
      expect.objectContaining({ vendorConfig: { deltaLink: 'fresh-delta' } })
    );
    expect(provider.provider_config?.deltaLink).toBe('fresh-delta');
    expect(deltaSpy).toHaveBeenCalled();
  });

  it('removes all mapped instances when a recurring Microsoft series is deleted', async () => {
    const provider = buildMicrosoftProvider();

    const masterId = 'recurrence-master';
    const occurrenceIds = [
      'recurrence-master_occurrence-01',
      'recurrence-master_occurrence-02',
    ];

    const mappingRows = await Promise.all(
      [masterId, ...occurrenceIds].map(async (externalId) => ({
        id: uuidv4(),
        tenant: tenantId,
        calendar_provider_id: provider.id,
        schedule_entry_id: uuidv4(),
        external_event_id: externalId,
        sync_status: 'synced',
        last_synced_at: new Date(),
        sync_direction: 'from_external',
        alga_last_modified: new Date(),
        external_last_modified: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      }))
    );
    await getActiveDb()('calendar_event_mappings').insert(mappingRows);

    const microsoftAdapter = {
      connect: vi.fn(async () => {}),
      fetchDeltaChanges: vi.fn(async () => ({
        changes: [
          { id: masterId, changeType: 'deleted' as const },
          { id: occurrenceIds[0], changeType: 'deleted' as const },
          { id: occurrenceIds[1], changeType: 'deleted' as const },
        ],
        deltaLink: 'delta-after-delete',
        resetRequired: false,
      })),
    };

    const processor = new CalendarWebhookProcessor();
    const syncServiceStub = {
      syncScheduleEntryToExternal: vi.fn(async () => ({ success: true })),
      syncExternalEventToSchedule: vi.fn(async () => ({ success: true })),
      deleteScheduleEntry: vi.fn(async (entryId: string, providerIdArg: string, scope: string) => {
        shared.deleteCalls.push({ entryId, providerId: providerIdArg, scope });
        return { success: true };
      }),
      resolveConflict: vi.fn(async () => ({ success: true })),
    };

    const providerServiceStub = {
      updateProvider: vi.fn(async (_id: string, _tenant: string, data: { vendorConfig?: Record<string, any> }) => {
        if (data.vendorConfig) {
          provider.provider_config = {
            ...provider.provider_config,
            ...data.vendorConfig,
          };
        }
      }),
    };

    (processor as any).syncService = syncServiceStub;
    (processor as any).providerService = providerServiceStub;

    vi.spyOn(processor as any, 'getProviderByMicrosoftSubscription').mockResolvedValue(provider);
    vi.spyOn(processor as any, 'createAdapter').mockResolvedValue(microsoftAdapter as any);

    const notifications = [
      {
        subscriptionId: 'subscription-series',
        clientState: 'verify-token',
        changeType: 'deleted',
        resourceData: { id: masterId },
      },
    ];

    const outcome = await processor.processMicrosoftWebhook(notifications);

    expect(outcome).toEqual({ success: 3, failed: 0 });
    expect(shared.deleteCalls).toEqual(
      mappingRows.map(row => ({ entryId: row.schedule_entry_id, providerId: provider.id, scope: 'all' }))
    );
    expect(syncServiceStub.syncExternalEventToSchedule).not.toHaveBeenCalled();
  });
});
