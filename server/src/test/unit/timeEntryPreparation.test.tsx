/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), periods: vi.fn(), zone: vi.fn(), sheet: vi.fn(), read: vi.fn(), save: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: mocks.error } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  translate: (_ns: string, _key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString() }),
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.user }));
vi.mock('@alga-psa/scheduling/actions/timePeriodsActions', () => ({ getTimeEntryUserTimeZone: mocks.zone }));
vi.mock('@alga-psa/scheduling/actions/timeSheetActions', () => ({ fetchTimeSheet: vi.fn() }));
vi.mock('@alga-psa/scheduling/actions/timeEntryActions', () => ({ fetchTimePeriods: mocks.periods, fetchOrCreateTimeSheet: mocks.sheet, getTimeEntryById: mocks.read, saveTimeEntry: mocks.save }));
vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryDialog', () => ({ default: () => null }));
import { prepareTimeEntryForWorkItem, launchTimeEntryForWorkItem } from '@alga-psa/scheduling/lib/timeEntryLauncher';
import { createCatalogSheetResolver, createTimeEntrySaveHandler } from '@alga-psa/scheduling/lib/timeEntrySaveAdapter';
const context = { workItemType: 'co_managed' as const, workItemId: 'local-reference', workItemName: 'Shared issue' };
// One draft period around "now", so the default day is always editable.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const period = { period_id: 'home-period', start_date: day(-10), end_date: day(10), timeSheetStatus: 'DRAFT' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ user_id: 'home-user' }); mocks.periods.mockResolvedValue([period]);
  mocks.zone.mockResolvedValue('UTC'); mocks.sheet.mockResolvedValue({ id: 'home-sheet', approval_status: 'DRAFT' }); mocks.save.mockResolvedValue({ entry_id: 'saved' });
});
it('prepares the native work item for the own user without a drawer, sheet or save', async () => {
  const prepared = await prepareTimeEntryForWorkItem(context);
  expect(prepared).toMatchObject({ workItem: { type: 'co_managed', work_item_id: 'local-reference', name: 'Shared issue' }, userId: 'home-user', periods: [period] });
  // The sheet is resolved at Save, so preparing (and cancelling) leaves nothing behind.
  expect(mocks.sheet).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps existing preparation failures visible without opening a form or creating a sheet', async () => {
  mocks.periods.mockResolvedValue([]); const openDrawer = vi.fn();
  await launchTimeEntryForWorkItem({ context, openDrawer, closeDrawer: vi.fn() });
  expect(openDrawer).not.toHaveBeenCalled(); expect(mocks.sheet).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('No time periods'), expect.anything());
});
it('lets the native dialog handle failed saves and completes only a successful save', async () => {
  const onComplete = vi.fn();
  const prepared = (await prepareTimeEntryForWorkItem(context))!;
  const save = createTimeEntrySaveHandler(onComplete, createCatalogSheetResolver({ userId: prepared.userId, periods: prepared.periods, timeZone: prepared.userTimeZone }));
  const entry = { start_time: new Date().toISOString(), notes: 'Draft' } as any;
  mocks.save.mockRejectedValueOnce(new Error('Permission changed'));
  await expect(save(entry)).rejects.toThrow('Permission changed');
  expect(onComplete).not.toHaveBeenCalled();
  await save({ ...entry, notes: 'Saved' });
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ notes: 'Saved', time_sheet_id: 'home-sheet' }));
  expect(onComplete).toHaveBeenCalledTimes(1);
});
