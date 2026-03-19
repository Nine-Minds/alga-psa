import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  providers: [] as any[],
  syncCalls: [] as Array<{ entryId: string; providerId: string }>,
  deleteCalls: [] as Array<{ entryId: string; providerId: string; scope: string }>,
}));

const eventHandlers = vi.hoisted(() => new Map<string, Set<(event: any) => Promise<void>>>());

vi.mock('server/src/lib/eventBus', () => ({
  getEventBus: () => ({
    subscribe: async (eventType: string, handler: (event: any) => Promise<void>) => {
      const handlers = eventHandlers.get(eventType) ?? new Set();
      handlers.add(handler);
      eventHandlers.set(eventType, handlers);
    },
  }),
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: async () => ({
    knex: vi.fn(),
    tenant: 'tenant-1',
  }),
  runWithTenant: async (_tenant: string, callback: () => Promise<any>) => callback(),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    sendEmail: vi.fn(async () => undefined),
  },
  StaticTemplateProcessor: class {},
}));

vi.mock('@enterprise/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProviders() {
      return shared.providers;
    }
  },
}));

vi.mock('@enterprise/lib/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: class {
    async syncScheduleEntryToExternal(entryId: string, providerId: string) {
      shared.syncCalls.push({ entryId, providerId });
      return { success: true, externalEventId: `ext-${entryId}` };
    }

    async deleteScheduleEntry(entryId: string, providerId: string, scope: string) {
      shared.deleteCalls.push({ entryId, providerId, scope });
      return { success: true };
    }
  },
}));

async function publish(eventType: string, payload: Record<string, any>) {
  const handlers = eventHandlers.get(eventType);
  if (!handlers) {
    return;
  }

  for (const handler of handlers) {
    await handler({
      id: `event-${eventType}`,
      timestamp: new Date().toISOString(),
      eventType,
      payload,
    });
  }
}

describe('enterprise calendarSyncSubscriber', () => {
  beforeEach(() => {
    eventHandlers.clear();
    shared.syncCalls.length = 0;
    shared.deleteCalls.length = 0;
    shared.providers = [
      {
        id: 'provider-1',
        tenant: 'tenant-1',
        user_id: 'user-1',
        sync_direction: 'bidirectional',
      },
    ];
  });

  it('syncs assigned schedule entries to active providers when registered', async () => {
    const subscriberModule = await import('@enterprise/lib/eventBus/subscribers/calendarSyncSubscriber');

    await subscriberModule.registerCalendarSyncSubscriber();
    await publish('SCHEDULE_ENTRY_CREATED', {
      entryId: 'entry-1',
      tenantId: 'tenant-1',
      changes: {
        assignedUserIds: ['user-1'],
      },
    });

    expect(shared.syncCalls).toEqual([{ entryId: 'entry-1', providerId: 'provider-1' }]);
  });

  it('removes schedule entries from assigned calendars on delete events', async () => {
    const subscriberModule = await import('@enterprise/lib/eventBus/subscribers/calendarSyncSubscriber');

    await subscriberModule.registerCalendarSyncSubscriber();
    await publish('SCHEDULE_ENTRY_DELETED', {
      entryId: 'entry-2',
      tenantId: 'tenant-1',
      changes: {
        before: {
          assignedUserIds: ['user-1'],
        },
      },
    });

    expect(shared.deleteCalls).toEqual([
      {
        entryId: 'entry-2',
        providerId: 'provider-1',
        scope: 'all',
      },
    ]);
  });
});
