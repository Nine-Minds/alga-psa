import { beforeEach, describe, expect, it, vi } from 'vitest';

const wheres: any[][] = [];
const query: any = {
  where: (...args: any[]) => { wheres.push(args); return query; },
  select: () => query,
  distinct: () => query,
  orderBy: () => query,
  then: (resolve: any) => resolve([]),
};

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  tenantDb: () => ({ table: () => query }),
}));
vi.mock('@alga-psa/scheduling/lib/calendarAccess', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  resolveCalendarAccess: vi.fn(async () => ({ hiddenCalendarIds: [] })),
  buildVisibilityFilter: vi.fn(() => null),
}));

import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';

// Date-only end_date reaches the service as an exclusive `end_before` bound.
describe('TimeSheetService.loadVisibleScheduleEntries date bounds', () => {
  const ctx = { userId: 'u1', tenant: 't1' } as any;

  async function load(filters: any) {
    const svc = new TimeSheetService() as any;
    vi.spyOn(svc, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(svc, 'canViewAllSchedules').mockResolvedValue(true);
    await svc.loadVisibleScheduleEntries(ctx, filters);
  }

  beforeEach(() => { wheres.length = 0; });

  it('applies end_before as a strict < on scheduled_end', async () => {
    await load({ end_before: '2026-11-05T00:00:00.000Z' });
    expect(wheres).toContainEqual(['scheduled_end', '<', '2026-11-05T00:00:00.000Z']);
    expect(wheres.some((w) => w[1] === '<=')).toBe(false);
  });

  it('keeps end_date inclusive (<=) for date-time input', async () => {
    await load({ end_date: '2026-11-04T16:00:00Z' });
    expect(wheres).toContainEqual(['scheduled_end', '<=', '2026-11-04T16:00:00Z']);
    expect(wheres.some((w) => w[1] === '<')).toBe(false);
  });
});
