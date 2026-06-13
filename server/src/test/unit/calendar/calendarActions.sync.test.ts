import { describe, expect, it, beforeEach, vi } from 'vitest';

const {
  mockCreateTenantKnex,
  mockRunWithTenant
} = vi.hoisted(() => {
  return {
    mockCreateTenantKnex: vi.fn(),
    mockRunWithTenant: vi.fn((_tenant: string, cb: () => Promise<any>) => cb()),
  };
});

// The concrete EE sync logic now lives in the ee-calendar package. The shared
// wrapper in @alga-psa/integrations only gates on edition and forwards to
// syncCalendarProviderImpl. Test the EE implementation directly with the
// service/adapter/db boundaries mocked so server-only deps stay out of jsdom.
vi.mock('@alga-psa/db', async () => ({
  createTenantKnex: mockCreateTenantKnex,
  runWithTenant: mockRunWithTenant,
  withTransaction: async (knex: any, callback: (trx: any) => Promise<any>) => callback(knex),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => undefined),
    getTenantSecret: vi.fn(async () => undefined),
  })),
}));

// Stub the heavy provider adapters (googleapis/axios/google-auth-library) so the
// EE actions module can be imported in jsdom without pulling server-only deps.
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter', () => ({
  GoogleCalendarAdapter: vi.fn().mockImplementation(() => ({
    connect: vi.fn(async () => undefined),
    registerWebhookSubscription: vi.fn(async () => undefined),
  })),
}));

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter', () => ({
  MicrosoftCalendarAdapter: vi.fn().mockImplementation(() => ({
    connect: vi.fn(async () => undefined),
    registerWebhookSubscription: vi.fn(async () => undefined),
  })),
}));

vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookMaintenanceService', () => ({
  CalendarWebhookMaintenanceService: vi.fn().mockImplementation(() => ({})),
}));

const mockGetProvider = vi.fn();
const mockUpdateProviderStatus = vi.fn();
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: vi.fn().mockImplementation(() => ({
    getProvider: mockGetProvider,
    updateProviderStatus: mockUpdateProviderStatus,
  }))
}));

const mockSyncScheduleEntryToExternal = vi.fn();
const mockSyncExternalEventToSchedule = vi.fn();
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: vi.fn().mockImplementation(() => ({
    syncScheduleEntryToExternal: mockSyncScheduleEntryToExternal,
    syncExternalEventToSchedule: mockSyncExternalEventToSchedule,
  }))
}));

import { syncCalendarProviderImpl } from '@alga-psa/ee-calendar/lib/actions/integrations/calendarActions';

const authUser = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' } as any;

function buildQuery(data: any[]) {
  const query: any = {
    where: vi.fn().mockImplementation((arg: any) => {
      if (typeof arg === 'function') {
        arg.call(query);
      }
      return query;
    }),
    andWhere: vi.fn().mockImplementation((arg: any) => {
      if (typeof arg === 'function') {
        arg.call(query);
      }
      return query;
    }),
    join: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue(data),
    modify: vi.fn().mockImplementation((cb) => {
      cb({ andWhere: vi.fn() });
      return query;
    }),
    leftJoin: vi.fn().mockReturnThis(),
    whereNull: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  return query;
}

function setupKnex(mappings: any[], recentEntries: any[] = []) {
  const mappingQuery = buildQuery(mappings);
  const recentQuery = buildQuery(recentEntries);
  const knexFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'calendar_event_mappings' || table === 'calendar_event_mappings as cem') {
      return mappingQuery;
    }
    if (table === 'schedule_entries' || table === 'schedule_entries as se') {
      return recentQuery;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  knexFn.raw = vi.fn().mockReturnValue('provider-id-binding');
  mockCreateTenantKnex.mockResolvedValue({ knex: knexFn, tenant: 'tenant-1' });
  return { knexFn };
}

describe('syncCalendarProvider manual flows', () => {
  beforeEach(() => {
    process.env.EDITION = 'enterprise';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    mockCreateTenantKnex.mockReset();
    mockRunWithTenant.mockReset();
    mockGetProvider.mockReset();
    mockUpdateProviderStatus.mockReset();
    mockSyncScheduleEntryToExternal.mockReset();
    mockSyncExternalEventToSchedule.mockReset();
    mockRunWithTenant.mockImplementation((_tenant: string, cb: () => Promise<any>) => cb());
  });

  it('T363/T364: EE-owned sync flows continue to operate against existing calendar provider rows after the ownership move', async () => {
    setupKnex([{ schedule_entry_id: 'entry-1', external_event_id: 'ext-1' }]);

    mockGetProvider.mockResolvedValue({
      id: 'provider-1',
      tenant: 'tenant-1',
      user_id: 'user-1',
      sync_direction: 'bidirectional',
      last_sync_at: null,
    });

    mockSyncScheduleEntryToExternal.mockResolvedValue({ success: true, externalEventId: 'ext-1' });
    mockSyncExternalEventToSchedule.mockResolvedValue({ success: true, scheduleEntryId: 'entry-1' });

    const result = await syncCalendarProviderImpl(authUser, { tenant: 'tenant-1' }, 'provider-1');

    expect(result).toEqual({ success: true, started: true });
    await vi.waitFor(() => {
      expect(mockSyncScheduleEntryToExternal).toHaveBeenCalledWith('entry-1', 'provider-1', true);
      expect(mockSyncExternalEventToSchedule).toHaveBeenCalledWith('ext-1', 'provider-1', true);
      expect(mockUpdateProviderStatus).toHaveBeenCalledWith(
        'provider-1',
        expect.objectContaining({ status: 'connected' })
      );
    });
  });

  it('only pulls external events when provider direction is from_external', async () => {
    setupKnex([{ schedule_entry_id: 'entry-2', external_event_id: 'ext-2' }]);

    mockGetProvider.mockResolvedValue({
      id: 'provider-2',
      tenant: 'tenant-1',
      user_id: 'user-1',
      sync_direction: 'from_external',
      last_sync_at: null,
    });

    mockSyncScheduleEntryToExternal.mockResolvedValue({ success: true });
    mockSyncExternalEventToSchedule.mockResolvedValue({ success: true });

    const result = await syncCalendarProviderImpl(authUser, { tenant: 'tenant-1' }, 'provider-2');

    expect(result).toEqual({ success: true, started: true });
    await vi.waitFor(() => {
      expect(mockSyncScheduleEntryToExternal).not.toHaveBeenCalled();
      expect(mockSyncExternalEventToSchedule).toHaveBeenCalledWith('ext-2', 'provider-2', true);
    });
  });
});
