/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), period: vi.fn(), sheet: vi.fn(), read: vi.fn(), save: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: { error: mocks.error } }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.user }));
vi.mock('@alga-psa/scheduling/actions/timePeriodsActions', () => ({ getCurrentTimePeriod: mocks.period }));
vi.mock('@alga-psa/scheduling/actions/timeEntryActions', () => ({ fetchOrCreateTimeSheet: mocks.sheet, getTimeEntryById: mocks.read, saveTimeEntry: mocks.save }));
vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryDialog', () => ({ default: () => null }));
import { prepareTimeEntryForWorkItem, launchTimeEntryForWorkItem } from '@alga-psa/scheduling/lib/timeEntryLauncher';
const context = { workItemType: 'co_managed' as const, workItemId: 'local-reference', workItemName: 'Shared issue' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ user_id: 'home-user' }); mocks.period.mockResolvedValue({ period_id: 'home-period' });
  mocks.sheet.mockResolvedValue({ id: 'home-sheet' }); mocks.save.mockResolvedValue({ entry_id: 'saved' });
});
it('prepares the native work item and own timesheet without requiring a drawer', async () => {
  const prepared = await prepareTimeEntryForWorkItem(context);
  expect(prepared).toMatchObject({ workItem: { type: 'co_managed', work_item_id: 'local-reference', name: 'Shared issue' }, timeSheetId: 'home-sheet' });
  expect(mocks.sheet).toHaveBeenCalledWith('home-user', 'home-period'); expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps existing preparation failures visible without opening a form or creating a sheet', async () => {
  mocks.period.mockResolvedValue(null); const openDrawer = vi.fn();
  await launchTimeEntryForWorkItem({ context, openDrawer, closeDrawer: vi.fn() });
  expect(openDrawer).not.toHaveBeenCalled(); expect(mocks.sheet).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('No time period'), expect.anything());
});
it('lets the native dialog handle failed saves and closes only a successful drawer save', async () => {
  const openDrawer = vi.fn(), closeDrawer = vi.fn(), onComplete = vi.fn();
  await launchTimeEntryForWorkItem({ context, openDrawer, closeDrawer, onComplete });
  const dialog = openDrawer.mock.calls[0][0] as React.ReactElement<any>;
  mocks.save.mockRejectedValueOnce(new Error('Permission changed'));
  await expect(dialog.props.onSave({ notes: 'Draft' })).rejects.toThrow('Permission changed');
  expect(closeDrawer).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
  await dialog.props.onSave({ notes: 'Saved' }); expect(closeDrawer).toHaveBeenCalledTimes(1); expect(onComplete).toHaveBeenCalledTimes(1);
});
