import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for card 7a25a001: removing an assignee must remove only that user's
 * provider copy. It must never delete the Alga schedule entry (the old code called
 * CalendarSyncService.deleteScheduleEntry, which also deletes the schedule_entries row).
 */

const shared = vi.hoisted(() => ({
  providers: [] as any[],
  syncCalls: [] as Array<{ entryId: string; providerId: string }>,
  removeCalls: [] as Array<{ entryId: string; providerId: string }>,
  deleteCalls: [] as Array<{ entryId: string; providerId: string; scope: string }>,
  removeErrors: new Map<string, Error>(),
  loggerInfo: [] as Array<{ message: string; meta: any }>,
  loggerError: [] as Array<{ message: string; meta: any }>,
}));

const eventHandlers = vi.hoisted(() => new Map<string, Set<(event: any) => Promise<void>>>());

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: () => ({
    subscribe: async (eventType: string, handler: (event: any) => Promise<void>) => {
      const handlers = eventHandlers.get(eventType) ?? new Set();
      handlers.add(handler);
      eventHandlers.set(eventType, handlers);
    },
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: (message: string, meta: any) => shared.loggerInfo.push({ message, meta }),
    error: (message: string, meta: any) => shared.loggerError.push({ message, meta }),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: vi.fn(), tenant: 'tenant-1' }),
  runWithTenant: async (_tenant: string, callback: () => Promise<any>) => callback(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { sendEmail: vi.fn(async () => undefined) },
  StaticTemplateProcessor: class {},
}));

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    async getProviders() {
      return shared.providers;
    }
  },
}));

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: class {
    async syncScheduleEntryToExternal(entryId: string, providerId: string) {
      shared.syncCalls.push({ entryId, providerId });
      return { success: true };
    }

    async removeProviderCopy(entryId: string, providerId: string) {
      shared.removeCalls.push({ entryId, providerId });
      const error = shared.removeErrors.get(providerId);
      if (error) throw error;
    }

    // Deletes the Alga row too; unassignment must never reach this.
    async deleteScheduleEntry(entryId: string, providerId: string, scope: string) {
      shared.deleteCalls.push({ entryId, providerId, scope });
      return { success: true };
    }
  },
}));

async function publish(eventType: string, payload: Record<string, any>) {
  for (const handler of eventHandlers.get(eventType) ?? []) {
    await handler({
      id: `event-${eventType}`,
      timestamp: new Date().toISOString(),
      eventType,
      payload,
    });
  }
}

const providerFor = (id: string, userId: string) => ({
  id,
  tenant: 'tenant-1',
  user_id: userId,
  sync_direction: 'bidirectional',
});

async function register() {
  const subscriberModule = await import('@alga-psa/ee-calendar/event-bus');
  await subscriberModule.registerCalendarSyncSubscriber();
}

describe('calendarSyncSubscriber SCHEDULE_ENTRY_UPDATED unassignment', () => {
  beforeEach(() => {
    eventHandlers.clear();
    shared.syncCalls.length = 0;
    shared.removeCalls.length = 0;
    shared.deleteCalls.length = 0;
    shared.removeErrors.clear();
    shared.loggerInfo.length = 0;
    shared.loggerError.length = 0;
    shared.providers = [providerFor('provider-a', 'user-a'), providerFor('provider-b', 'user-b')];
  });

  it('unassigning A removes only A\'s provider copy, never the Alga entry, and leaves B untouched', async () => {
    await register();
    await publish('SCHEDULE_ENTRY_UPDATED', {
      entryId: 'entry-1',
      tenantId: 'tenant-1',
      changes: {
        before: { assignedUserIds: ['user-a', 'user-b'] },
        after: { assignedUserIds: ['user-b'] },
      },
    });

    expect(shared.removeCalls).toEqual([{ entryId: 'entry-1', providerId: 'provider-a' }]);
    expect(shared.deleteCalls).toEqual([]);
    // B is still assigned: it is re-synced as an update, not cancelled or removed.
    expect(shared.syncCalls).toEqual([{ entryId: 'entry-1', providerId: 'provider-b' }]);
    expect(shared.loggerInfo.map((l) => l.message)).toContain(
      '[CalendarSyncSubscriber] Removed provider copy after user unassignment',
    );
    expect(shared.loggerInfo.map((l) => l.message)).not.toContain(
      '[CalendarSyncSubscriber] Removed entry from calendar after user unassignment',
    );
  });

  it('reassigning A -> B removes A\'s copy, creates B\'s copy, and keeps the same entry id', async () => {
    await register();

    await publish('SCHEDULE_ENTRY_UPDATED', {
      entryId: 'entry-1',
      tenantId: 'tenant-1',
      changes: {
        before: { assignedUserIds: ['user-a'] },
        after: { assignedUserIds: ['user-b'] },
      },
    });

    expect(shared.removeCalls).toEqual([{ entryId: 'entry-1', providerId: 'provider-a' }]);
    expect(shared.syncCalls).toEqual([{ entryId: 'entry-1', providerId: 'provider-b' }]);
    expect(shared.deleteCalls).toEqual([]);
  });

  it('personal -> group move with the assignee cleared keeps the entry and syncs nothing externally', async () => {
    await register();

    await publish('SCHEDULE_ENTRY_UPDATED', {
      entryId: 'entry-1',
      tenantId: 'tenant-1',
      changes: {
        before: { assignedUserIds: ['user-a'] },
        after: { assignedUserIds: [] },
      },
    });

    // Only A's stale provider copy goes; nothing is created for the unassigned group entry.
    expect(shared.removeCalls).toEqual([{ entryId: 'entry-1', providerId: 'provider-a' }]);
    expect(shared.syncCalls).toEqual([]);
    expect(shared.deleteCalls).toEqual([]);
  });

  it('recurring single/future update: new entry id survives and a still-assigned user gets no removal', async () => {
    await register();

    // The split path creates a new standalone/master id; the event carries the original id.
    await publish('SCHEDULE_ENTRY_UPDATED', {
      entryId: 'master-old-id',
      tenantId: 'tenant-1',
      changes: {
        before: { id: 'master-old-id', assignedUserIds: ['user-a', 'user-b'] },
        after: { id: 'new-standalone-id', assignedUserIds: ['user-a', 'user-b'] },
        updateType: 'single',
      },
    });

    expect(shared.deleteCalls).toEqual([]);
    expect(shared.removeCalls).toEqual([]);
    expect(shared.syncCalls).toEqual([
      { entryId: 'master-old-id', providerId: 'provider-a' },
      { entryId: 'master-old-id', providerId: 'provider-b' },
    ]);
  });

  it('recurring split that drops an assignee removes only that provider copy by id, never deletes a row', async () => {
    await register();

    await publish('SCHEDULE_ENTRY_UPDATED', {
      entryId: 'master-old-id',
      tenantId: 'tenant-1',
      changes: {
        before: { assignedUserIds: ['user-a', 'user-b'] },
        after: { id: 'new-standalone-id', assignedUserIds: ['user-b'] },
        updateType: 'future',
      },
    });

    expect(shared.deleteCalls).toEqual([]);
    expect(shared.removeCalls).toEqual([{ entryId: 'master-old-id', providerId: 'provider-a' }]);
    expect(shared.syncCalls).toEqual([{ entryId: 'master-old-id', providerId: 'provider-b' }]);
  });

  it('logs and continues when removeProviderCopy fails, still syncing the remaining providers', async () => {
    await register();
    shared.removeErrors.set('provider-a', new Error('Graph 503 service unavailable'));

    await expect(
      publish('SCHEDULE_ENTRY_UPDATED', {
        entryId: 'entry-1',
        tenantId: 'tenant-1',
        changes: {
          before: { assignedUserIds: ['user-a', 'user-b'] },
          after: { assignedUserIds: ['user-b'] },
        },
      }),
    ).resolves.toBeUndefined();

    expect(shared.deleteCalls).toEqual([]);
    expect(shared.syncCalls).toEqual([{ entryId: 'entry-1', providerId: 'provider-b' }]);
    expect(shared.loggerError).toHaveLength(1);
    expect(shared.loggerError[0].message).toBe(
      '[CalendarSyncSubscriber] Failed to remove provider copy after user unassignment',
    );
    expect(shared.loggerError[0].meta).toMatchObject({
      entryId: 'entry-1',
      calendarProviderId: 'provider-a',
      userId: 'user-a',
      error: 'Graph 503 service unavailable',
    });
    // The success message must not be logged for the failed removal.
    expect(shared.loggerInfo.map((l) => l.message)).not.toContain(
      '[CalendarSyncSubscriber] Removed provider copy after user unassignment',
    );
  });
});
