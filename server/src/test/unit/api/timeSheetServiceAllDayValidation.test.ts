import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, update: vi.fn(), publish: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  BaseService: class { async getKnex() { return { knex: {} }; } },
  withTransaction: async (_knex: unknown, callback: (trx: object) => unknown) => callback({}),
  tenantDb: () => ({ table: (name: string) => {
    const query = {
      where: () => query,
      forShare: () => query,
      // Answer per table rather than handing the schedule row to every query. This
      // subject is an ordinary PSA tenant: product_code 'psa', no operational time
      // entries. That is what makes retainCoManagedTimeCalendar decline, so the
      // co-managed native schedule command returns { handled: false } and the generic
      // path under test actually runs. A mock that returns the same row for every
      // table instead reports a co-managed calendar on every tenant.
      first: async () => name === 'schedule_entries' ? { ...state.row }
        : name === 'tenants' ? { product_code: 'psa', suspended_at: null }
        : undefined,
      pluck: async () => name === 'schedule_entry_assignees' ? ['owner'] : [],
      update: async (patch: Record<string, unknown>) => { state.update(patch); Object.assign(state.row, patch); return 1; },
    };
    return query;
  } }),
}));
// This suite covers the generic schedule path: an ordinary PSA tenant, where
// retainCoManagedTimeCalendar declines and the co-managed native command returns
// { handled: false }. Stub that boundary explicitly rather than leave it to the db mock,
// which cannot model the engine's reads and would otherwise let it claim the update and
// fail on an incomplete row. Co-managed tenants take the native command instead, and its
// own all-day rule is covered by nativeScheduleCommandAllDay.test.ts.
vi.mock('@alga-psa/co-managed', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  commandCoManagedNativeSchedule: async () => ({ handled: false }),
}));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: state.publish }));
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
