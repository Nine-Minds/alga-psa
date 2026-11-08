import { describe, expect, it, vi } from 'vitest';
import { TimeSheetService } from '../../../lib/api/services/TimeSheetService';

// Pagination must run AFTER visibility filtering so `total` never counts hidden entries.
describe('TimeSheetService.getScheduleEntriesPage', () => {
  const ctx = { userId: 'u1', tenant: 't1' } as any;

  function makeService(visible: any[]) {
    const svc = new TimeSheetService() as any;
    const load = vi.spyOn(svc, 'loadVisibleScheduleEntries').mockResolvedValue({ visible, access: {} });
    const build = vi.spyOn(svc, 'buildScheduleEntryResult').mockImplementation(async (c: any) => ({ entry_id: c.entry.entry_id }));
    return { svc, load, build };
  }

  const visible = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ entry: { entry_id: id }, assignedUsers: [], decision: {} }));

  it('totals only visible entries and slices the requested page', async () => {
    const { svc, load, build } = makeService(visible);
    const res = await svc.getScheduleEntriesPage(ctx, { user_id: 'x' }, { page: 2, limit: 2 });
    expect(load).toHaveBeenCalledWith(ctx, { user_id: 'x' });
    expect(res).toEqual({ data: [{ entry_id: 'c' }, { entry_id: 'd' }], total: 5 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('returns empty data but the full total past the last page', async () => {
    const { svc } = makeService(visible);
    expect(await svc.getScheduleEntriesPage(ctx, {}, { page: 4, limit: 2 })).toEqual({ data: [], total: 5 });
  });
});
