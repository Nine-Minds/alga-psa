import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, update: vi.fn(), publish: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  BaseService: class { async getKnex() { return { knex: {} }; } },
  withTransaction: async (_knex: unknown, callback: (trx: object) => unknown) => callback({}),
  tenantDb: () => ({ table: (name: string) => {
    const query = {
      where: () => query,
      first: async () => ({ ...state.row }),
      pluck: async () => name === 'schedule_entry_assignees' ? ['owner'] : [],
      update: async (patch: Record<string, unknown>) => { state.update(patch); Object.assign(state.row, patch); return 1; },
    };
    return query;
  } }),
}));
// TimeSheetService now publishes SCHEDULE_ENTRY_UPDATED through the typed publishWorkflowEvent from
// @alga-psa/event-bus/publishers, so the publication assertions (state.publish) are bound to that function.
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: state.publish, publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
// updateScheduleEntry resolves shared-calendar access before validating; stub the resolver (the tenantDb mock has no .select).
vi.mock('@alga-psa/scheduling/lib/calendarAccess', () => ({
  resolveCalendarAccess: vi.fn(async () => ({})),
  evaluateEntryAccess: vi.fn(() => ({ access: 'full', canEdit: true })),
  canAssignUser: vi.fn(() => true),
  buildVisibilityFilter: vi.fn(() => undefined),
  assertEditableGroupCalendar: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/scheduling/models/timePeriod', () => ({ TimePeriod: {} }));
vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: vi.fn().mockResolvedValue(true) }));
vi.mock('../../../lib/api/middleware/apiMiddleware', () => ({
  BadRequestError: class extends Error {}, ConflictError: class extends Error {},
  ForbiddenError: class extends Error {}, NotFoundError: class extends Error {},
}));

import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';

describe('schedule API all-day update validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.row = { entry_id: 'entry', tenant: 'tenant', created_by: 'owner', is_private: false,
      is_all_day: true, scheduled_start: new Date('2026-10-25T00:00:00Z'), scheduled_end: new Date('2026-10-26T00:00:00Z') };
  });

  const update = async (patch: Record<string, unknown>) => {
    const service = new TimeSheetService();
    vi.spyOn(service, 'getScheduleEntry').mockImplementation(async () => ({ ...state.row }));
    return service.updateScheduleEntry('entry', patch as any, { tenant: 'tenant', userId: 'owner', user: {} } as any);
  };

  it('rejects converting timed dates to all-day before persistence or publication', async () => {
    Object.assign(state.row, { is_all_day: false, scheduled_start: new Date('2026-10-25T09:00:00Z') });
    await expect(update({ is_all_day: true })).rejects.toThrow(/all-day/i);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.row.is_all_day).toBe(false);
  });

  it('validates an all-day partial date update against the existing flag', async () => {
    await expect(update({ scheduled_end: '2026-10-26T09:00:00Z' })).rejects.toThrow(/all-day/i);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
  });

  it('allows an explicit conversion to timed with non-midnight dates', async () => {
    const result = await update({ is_all_day: false, scheduled_start: '2026-10-25T09:00:00Z' });
    expect(result).toMatchObject({ is_all_day: false, scheduled_start: '2026-10-25T09:00:00Z' });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.publish).toHaveBeenCalledTimes(1);
  });

  it('allows a title-only save without dropping all-day provenance', async () => {
    expect(await update({ title: 'Renamed' })).toMatchObject({ title: 'Renamed', is_all_day: true });
    expect(state.update).toHaveBeenCalledTimes(1);
  });
});
