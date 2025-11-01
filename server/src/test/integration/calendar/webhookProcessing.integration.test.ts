import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig.ts';
import { CalendarWebhookProcessor } from '../../../services/calendar/CalendarWebhookProcessor';

const shared = vi.hoisted(() => ({
  db: null as Knex | null,
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
        knex: shared.db,
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
    await db('calendar_event_mappings').where({ tenant: tenantId }).del();
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

    await db('calendar_event_mappings').insert({
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

    await db('calendar_event_mappings').insert({
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
});
