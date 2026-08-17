import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchTimeEntryForWorkItem } from '../src/lib/timeEntryLauncher';

// Behavioral coverage for the release-v1.5-feature gate on time-entry launch
// feedback. Flag OFF (no enhancedLaunchFeedback) must reproduce the exact
// legacy toast surface: plain single-argument toast.error calls with the
// legacy no-time-period copy. Flag ON switches to the deduplicated
// long-lived blocked toast with the refreshed copy.

const { getCurrentUser, getCurrentTimePeriod, fetchOrCreateTimeSheet, getTimeEntryById, toastError } =
  vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getCurrentTimePeriod: vi.fn(),
    fetchOrCreateTimeSheet: vi.fn(),
    getTimeEntryById: vi.fn(),
    toastError: vi.fn(),
  }));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser,
}));

vi.mock('../src/actions/timePeriodsActions', () => ({
  getCurrentTimePeriod,
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchOrCreateTimeSheet,
  saveTimeEntry: vi.fn(),
  getTimeEntryById,
}));

vi.mock('react-hot-toast', () => ({
  toast: { error: toastError },
}));

// TimeEntryDialog drags in the whole time-entry component tree (which reaches
// next-auth); the dialog never renders in these tests, so stub it.
vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntryDialog', () => ({
  default: () => null,
}));

const baseContext = {
  workItemId: 'ticket-1',
  workItemType: 'ticket' as const,
  workItemName: 'Ticket 1',
};

beforeEach(() => {
  toastError.mockClear();
  getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  getCurrentTimePeriod.mockResolvedValue({
    period_id: 'period-1',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
  });
  fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-1' });
  getTimeEntryById.mockResolvedValue(null);
});

describe('launchTimeEntryForWorkItem launch feedback (release-v1.5-feature)', () => {
  it('flag off: uses the exact legacy plain toast and copy when no time period covers today', async () => {
    getCurrentTimePeriod.mockResolvedValueOnce(null);

    await launchTimeEntryForWorkItem({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: baseContext,
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      'No active time period found. Please configure time periods before entering time.',
    );
  });

  it('flag off: precondition failure toasts carry no toast options', async () => {
    getCurrentTimePeriod.mockResolvedValueOnce(null);

    await launchTimeEntryForWorkItem({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: baseContext,
    });

    expect(toastError.mock.calls[0].length).toBe(1);
  });

  it('flag off: other blocked launches also use the plain single-argument toast', async () => {
    getTimeEntryById.mockResolvedValueOnce(null);

    await launchTimeEntryForWorkItem({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: baseContext,
      existingEntryId: 'entry-404',
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Time entry not found.');
    expect(toastError.mock.calls[0].length).toBe(1);
  });

  it('flag on: no time period uses the refreshed copy on the deduplicated long-lived toast', async () => {
    getCurrentTimePeriod.mockResolvedValueOnce(null);

    await launchTimeEntryForWorkItem({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: baseContext,
      enhancedLaunchFeedback: true,
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      'No time period covers today, so time can’t be entered yet. Ask an administrator to create time periods under Settings → Time Entry.',
      { id: 'time-entry-launch-blocked', duration: 10000 },
    );
  });

  it('flag on: repeated blocked launches reuse one toast id', async () => {
    getCurrentTimePeriod.mockResolvedValue(null);

    await launchTimeEntryForWorkItem({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: baseContext,
      enhancedLaunchFeedback: true,
    });
    await launchTimeEntryForWorkItem({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: baseContext,
      enhancedLaunchFeedback: true,
    });

    expect(toastError).toHaveBeenCalledTimes(2);
    for (const call of toastError.mock.calls) {
      expect(call[1]).toEqual({ id: 'time-entry-launch-blocked', duration: 10000 });
    }
  });
});
