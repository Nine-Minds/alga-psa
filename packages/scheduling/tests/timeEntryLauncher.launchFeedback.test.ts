import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchTimeEntryForWorkItem } from '../src/lib/timeEntryLauncher';

// Launcher-level behavioral coverage: which stage opens (blocked toast, the
// new-entry form, or the anchored existing-entry dialog) and the copy shown when
// the period catalog or a sheet lookup fails. Rendered new-entry behavior lives
// in newWorkItemTimeEntry.test.tsx.

const {
  getCurrentUser,
  getTimeEntryUserTimeZone,
  fetchTimePeriods,
  fetchOrCreateTimeSheet,
  getTimeEntryById,
  fetchTimeSheet,
  toastError,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getTimeEntryUserTimeZone: vi.fn(),
  fetchTimePeriods: vi.fn(),
  fetchOrCreateTimeSheet: vi.fn(),
  getTimeEntryById: vi.fn(),
  fetchTimeSheet: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@alga-psa/users/actions', () => ({ getCurrentUser }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser }));

vi.mock('../src/actions/timePeriodsActions', () => ({
  getTimeEntryUserTimeZone,
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchTimePeriods,
  fetchOrCreateTimeSheet,
  saveTimeEntry: vi.fn(),
  getTimeEntryById,
}));

vi.mock('../src/actions/timeSheetActions', () => ({ fetchTimeSheet }));

vi.mock('react-hot-toast', () => ({ toast: { error: toastError } }));

// The launcher translates imperative messages through the module-level helper.
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ formatDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10) }),
  useTranslation: () => ({ t: (_key: string, options?: any) => options?.defaultValue ?? _key }),
  translate: (_namespace: string, _key: string, options?: any) => options?.defaultValue ?? _key,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntryDialog', () => ({
  default: () => null,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/NewWorkItemTimeEntry', () => ({
  default: () => null,
}));

// The drawer receives a React element but never renders it here, so read the
// props off the element rather than from a component body.
const openedProps = (openDrawer: ReturnType<typeof vi.fn>): any => openDrawer.mock.calls[0][0].props;

const baseContext = {
  workItemId: 'ticket-1',
  workItemType: 'ticket' as const,
  workItemName: 'Ticket 1',
};

const periods = [
  { period_id: 'period-current', start_date: '2026-09-01', end_date: '2026-09-08', timeSheetStatus: 'DRAFT', timeSheetId: 'sheet-current' },
  { period_id: 'period-prior', start_date: '2026-08-01', end_date: '2026-08-08', timeSheetStatus: 'DRAFT', timeSheetId: null },
];

beforeEach(() => {
  toastError.mockClear();
  getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  getTimeEntryUserTimeZone.mockResolvedValue('America/New_York');
  fetchTimePeriods.mockResolvedValue(periods);
  fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-1' });
  getTimeEntryById.mockResolvedValue(null);
  fetchTimeSheet.mockReset();
});

describe('launchTimeEntryForWorkItem launch feedback', () => {
  it('an empty catalog uses the refreshed copy on the deduplicated long-lived toast', async () => {
    fetchTimePeriods.mockResolvedValueOnce([]);
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext });

    expect(openDrawer).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      'No time periods are set up yet, so time can’t be entered. Ask an administrator to create time periods under Settings → Time Entry.',
      { id: 'time-entry-launch-blocked', duration: 10000 },
    );
  });

  it('repeated blocked launches reuse one toast id', async () => {
    fetchTimePeriods.mockResolvedValue([]);

    await launchTimeEntryForWorkItem({ openDrawer: vi.fn(), closeDrawer: vi.fn(), context: baseContext });
    await launchTimeEntryForWorkItem({ openDrawer: vi.fn(), closeDrawer: vi.fn(), context: baseContext });

    expect(toastError).toHaveBeenCalledTimes(2);
    for (const call of toastError.mock.calls) {
      expect(call[1]).toEqual({ id: 'time-entry-launch-blocked', duration: 10000 });
    }
  });

  it('propagates a period-list failure without opening a stage', async () => {
    fetchTimePeriods.mockResolvedValueOnce({ actionError: 'Unable to list periods.' });
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext });

    expect(openDrawer).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Unable to list periods.', { id: 'time-entry-launch-blocked', duration: 10000 });
  });

  it('opens the new-entry form directly with the catalog and today’s defaults, creating no sheet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-03T15:00:00Z'));
    try {
      const openDrawer = vi.fn();

      await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext });

      expect(openDrawer).toHaveBeenCalledTimes(1);
      const props = openedProps(openDrawer);
      expect(props.periods).toEqual(periods);
      expect(props.userTimeZone).toBe('America/New_York');
      expect(props.defaults.moved).toEqual({ kind: 'none' });
      // 08:00 in New York on Sep 3.
      expect(props.defaults.defaultStartTime.toISOString()).toBe('2026-09-03T12:00:00.000Z');
      expect(fetchOrCreateTimeSheet).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves the default to the nearest editable day when no period covers today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-20T15:00:00Z'));
    try {
      const openDrawer = vi.fn();

      await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext });

      expect(openedProps(openDrawer).defaults.moved).toEqual({
        kind: 'today',
        date: '2026-08-07',
        todayStatus: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks with an explanation when every sheet is submitted or approved', async () => {
    fetchTimePeriods.mockResolvedValueOnce(periods.map((p) => ({ ...p, timeSheetStatus: 'SUBMITTED' })));
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext });

    expect(openDrawer).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      'Every time sheet is submitted or approved, so there is no day to add time to. Ask an approver to reopen a sheet, or an administrator to add a time period.',
      { id: 'time-entry-launch-blocked', duration: 10000 },
    );
  });

  it('anchors an existing entry to its saved sheet period and status without the new-entry catalog', async () => {
    getTimeEntryById.mockResolvedValueOnce({
      entry_id: 'entry-1',
      time_sheet_id: 'sheet-old',
      start_time: '2026-02-10T14:00:00.000Z',
      end_time: '2026-02-10T15:00:00.000Z',
    });
    fetchTimeSheet.mockResolvedValueOnce({
      id: 'sheet-old',
      approval_status: 'CHANGES_REQUESTED',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-old', start_date: '2026-02-01', end_date: '2026-02-08' },
    });
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext, existingEntryId: 'entry-1' });

    expect(fetchOrCreateTimeSheet).not.toHaveBeenCalled();
    const props = openedProps(openDrawer);
    expect(props.savedSheet.id).toBe('sheet-old');
    expect(props.savedSheet.time_period.period_id).toBe('period-old');
    expect(props.existingEntry.entry_id).toBe('entry-1');
  });

  it('opens a locked existing sheet through the anchored dialog with its locked status', async () => {
    getTimeEntryById.mockResolvedValueOnce({
      entry_id: 'entry-2',
      time_sheet_id: 'sheet-submitted',
      start_time: '2026-02-10T14:00:00.000Z',
      end_time: '2026-02-10T15:00:00.000Z',
    });
    fetchTimeSheet.mockResolvedValueOnce({
      id: 'sheet-submitted',
      approval_status: 'SUBMITTED',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-old', start_date: '2026-02-01', end_date: '2026-02-08' },
    });
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext, existingEntryId: 'entry-2' });

    const props = openedProps(openDrawer);
    expect(props.savedSheet.approval_status).toBe('SUBMITTED');
    expect(props.existingEntry.time_sheet_id).toBe('sheet-submitted');
  });

  it('reports a saved sheet lookup failure and does not open a form', async () => {
    getTimeEntryById.mockResolvedValueOnce({
      entry_id: 'entry-3',
      time_sheet_id: 'sheet-gone',
      start_time: '2026-02-10T14:00:00.000Z',
      end_time: '2026-02-10T15:00:00.000Z',
    });
    fetchTimeSheet.mockResolvedValueOnce({ actionError: 'Time sheet not found. It may have been deleted. Please refresh and try again.' });
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext, existingEntryId: 'entry-3' });

    expect(openDrawer).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      'Time sheet not found. It may have been deleted. Please refresh and try again.',
      { id: 'time-entry-launch-blocked', duration: 10000 },
    );
  });

  it('reports a missing existing entry with the deduplicated blocked toast', async () => {
    getTimeEntryById.mockResolvedValueOnce(null);
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({ openDrawer, closeDrawer: vi.fn(), context: baseContext, existingEntryId: 'entry-404' });

    expect(openDrawer).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Time entry not found.', { id: 'time-entry-launch-blocked', duration: 10000 });
  });
});
