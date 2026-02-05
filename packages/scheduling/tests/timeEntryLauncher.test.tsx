import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchTimeEntryForWorkItem } from '../src/lib/timeEntryLauncher';

const getCurrentUser = vi.fn();
vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser,
}));

const getCurrentTimePeriod = vi.fn();
vi.mock('../src/actions/timePeriodsActions', () => ({
  getCurrentTimePeriod,
}));

const fetchOrCreateTimeSheet = vi.fn();
const saveTimeEntry = vi.fn();
vi.mock('../src/actions/timeEntryActions', () => ({
  fetchOrCreateTimeSheet,
  saveTimeEntry,
}));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { error: toastError },
}));

beforeEach(() => {
  getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  getCurrentTimePeriod.mockResolvedValue({
    period_id: 'period-1',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
  });
  fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-1' });
  saveTimeEntry.mockResolvedValue({});
});

describe('launchTimeEntryForWorkItem', () => {
  it('fetches current time period before opening the dialog', async () => {
    const openDrawer = vi.fn();
    await launchTimeEntryForWorkItem({
      openDrawer,
      closeDrawer: vi.fn(),
      context: {
        workItemId: 'ticket-1',
        workItemType: 'ticket',
        workItemName: 'Ticket 1',
      },
    });

    expect(getCurrentTimePeriod).toHaveBeenCalled();
    expect(openDrawer).toHaveBeenCalled();
  });
});
