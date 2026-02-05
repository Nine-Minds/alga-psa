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

  it('creates or fetches a time sheet for the current user and period', async () => {
    await launchTimeEntryForWorkItem({
      openDrawer: vi.fn(),
      closeDrawer: vi.fn(),
      context: {
        workItemId: 'ticket-1',
        workItemType: 'ticket',
        workItemName: 'Ticket 1',
      },
    });

    expect(fetchOrCreateTimeSheet).toHaveBeenCalledWith('user-1', 'period-1');
  });

  it('builds a ticket work item with ticket context', async () => {
    const openDrawer = vi.fn();
    await launchTimeEntryForWorkItem({
      openDrawer,
      closeDrawer: vi.fn(),
      context: {
        workItemId: 'ticket-1',
        workItemType: 'ticket',
        workItemName: 'Ticket 1',
        ticketNumber: 'T-123',
        clientName: 'Acme',
        timeDescription: 'Worked on issue',
      },
    });

    const element = openDrawer.mock.calls[0][0] as React.ReactElement;
    expect(element.props.workItem.work_item_id).toBe('ticket-1');
    expect(element.props.workItem.type).toBe('ticket');
    expect(element.props.workItem.name).toBe('Ticket 1');
    expect(element.props.workItem.ticket_number).toBe('T-123');
    expect(element.props.workItem.client_name).toBe('Acme');
    expect(element.props.workItem.description).toBe('Worked on issue');
  });
});
