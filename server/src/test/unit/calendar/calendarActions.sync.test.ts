import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

const {
  userActionsModulePath,
  userActionsModulePathNoExt,
  mockGetCurrentUser,
  mockHasPermission,
  mockCreateTenantKnex,
  mockRunWithTenant
} = vi.hoisted(() => {
  const calendarActionsModuleUrl = new URL('../../../lib/actions/calendarActions.ts', import.meta.url);
  const userPath = new URL('../user-actions/userActions.ts', calendarActionsModuleUrl).pathname;
  const userPathNoExt = userPath.replace(/\.ts$/, '');

  return {
    userActionsModulePath: userPath,
    userActionsModulePathNoExt: userPathNoExt,
    mockGetCurrentUser: vi.fn(),
    mockHasPermission: vi.fn(),
    mockCreateTenantKnex: vi.fn(),
    mockRunWithTenant: vi.fn((_tenant: string, cb: () => Promise<any>) => cb()),
  };
});

vi.mock(userActionsModulePath, () => ({
  getCurrentUser: mockGetCurrentUser
}), { virtual: true });
vi.mock(userActionsModulePathNoExt, () => ({
  getCurrentUser: mockGetCurrentUser
}), { virtual: true });
vi.mock(new URL('../../../lib/auth/rbac.ts', import.meta.url).pathname, () => ({
  hasPermission: mockHasPermission
}));
vi.mock(new URL('../../../lib/db/index.tsx', import.meta.url).pathname, () => ({
  createTenantKnex: mockCreateTenantKnex,
  runWithTenant: mockRunWithTenant,
}));

const mockGetProvider = vi.fn();
const mockUpdateProviderStatus = vi.fn();
vi.mock('@/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: vi.fn().mockImplementation(() => ({
    getProvider: mockGetProvider,
    updateProviderStatus: mockUpdateProviderStatus,
  }))
}));

const mockSyncScheduleEntryToExternal = vi.fn();
const mockSyncExternalEventToSchedule = vi.fn();
vi.mock('@/services/calendar/CalendarSyncService', () => ({
  CalendarSyncService: vi.fn().mockImplementation(() => ({
    syncScheduleEntryToExternal: mockSyncScheduleEntryToExternal,
    syncExternalEventToSchedule: mockSyncExternalEventToSchedule,
  }))
}));

import { syncCalendarProvider } from '../../../lib/actions/calendarActions.ts';

function buildQuery(data: any[]) {
  const query: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
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
    if (table === 'calendar_event_mappings') {
      return mappingQuery;
    }
    if (table === 'schedule_entries') {
      return recentQuery;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  mockCreateTenantKnex.mockResolvedValue({ knex: knexFn, tenant: 'tenant-1' });
  return { knexFn };
}

describe('syncCalendarProvider manual flows', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset();
    mockHasPermission.mockReset();
    mockCreateTenantKnex.mockReset();
    mockRunWithTenant.mockReset();
    mockGetProvider.mockReset();
    mockUpdateProviderStatus.mockReset();
    mockSyncScheduleEntryToExternal.mockReset();
    mockSyncExternalEventToSchedule.mockReset();

    mockGetCurrentUser.mockResolvedValue({ tenant: 'tenant-1', user_id: 'user-1' });
    mockHasPermission.mockResolvedValue(true);
    mockRunWithTenant.mockImplementation((_tenant: string, cb: () => Promise<any>) => cb());
  });

  it('pushes schedule entries to external provider and pulls external changes', async () => {
    setupKnex([{ schedule_entry_id: 'entry-1', external_event_id: 'ext-1' }]);

    mockGetProvider.mockResolvedValue({
      id: 'provider-1',
      tenant: 'tenant-1',
      sync_direction: 'bidirectional',
      last_sync_at: null,
    });

    mockSyncScheduleEntryToExternal.mockResolvedValue({ success: true, externalEventId: 'ext-1' });
    mockSyncExternalEventToSchedule.mockResolvedValue({ success: true, scheduleEntryId: 'entry-1' });

    const result = await syncCalendarProvider('provider-1');

    expect(result).toEqual({ success: true });
    expect(mockSyncScheduleEntryToExternal).toHaveBeenCalledWith('entry-1', 'provider-1', true);
    expect(mockSyncExternalEventToSchedule).toHaveBeenCalledWith('ext-1', 'provider-1', true);
    expect(mockUpdateProviderStatus).toHaveBeenCalledWith('provider-1', expect.objectContaining({ status: 'connected' }));
  });

  it('only pulls external events when provider direction is from_external', async () => {
    setupKnex([{ schedule_entry_id: 'entry-2', external_event_id: 'ext-2' }]);

    mockGetProvider.mockResolvedValue({
      id: 'provider-2',
      tenant: 'tenant-1',
      sync_direction: 'from_external',
      last_sync_at: null,
    });

    mockSyncScheduleEntryToExternal.mockResolvedValue({ success: true });
    mockSyncExternalEventToSchedule.mockResolvedValue({ success: true });

    const result = await syncCalendarProvider('provider-2');

    expect(result).toEqual({ success: true });
    expect(mockSyncScheduleEntryToExternal).not.toHaveBeenCalled();
    expect(mockSyncExternalEventToSchedule).toHaveBeenCalledWith('ext-2', 'provider-2', true);
  });
});
