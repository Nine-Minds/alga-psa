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

  it('builds an interaction work item with interaction context', async () => {
    const openDrawer = vi.fn();
    const start = new Date('2026-02-01T09:00:00Z');
    const end = new Date('2026-02-01T10:00:00Z');

    await launchTimeEntryForWorkItem({
      openDrawer,
      closeDrawer: vi.fn(),
      context: {
        workItemId: 'interaction-1',
        workItemType: 'interaction',
        workItemName: 'Follow-up',
        interactionType: 'Call',
        clientName: 'Globex',
        startTime: start,
        endTime: end,
      },
    });

    const element = openDrawer.mock.calls[0][0] as React.ReactElement;
    expect(element.props.workItem.work_item_id).toBe('interaction-1');
    expect(element.props.workItem.type).toBe('interaction');
    expect(element.props.workItem.interaction_type).toBe('Call');
    expect(element.props.workItem.client_name).toBe('Globex');
    expect(element.props.workItem.startTime).toEqual(start);
    expect(element.props.workItem.endTime).toEqual(end);
  });

  it('builds a project task work item with task context', async () => {
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({
      openDrawer,
      closeDrawer: vi.fn(),
      context: {
        workItemId: 'task-1',
        workItemType: 'project_task',
        workItemName: 'Build feature',
        projectName: 'Project A',
        phaseName: 'Phase 2',
        taskName: 'Build feature',
        serviceId: 'service-1',
        serviceName: 'Implementation',
      },
    });

    const element = openDrawer.mock.calls[0][0] as React.ReactElement;
    expect(element.props.workItem.type).toBe('project_task');
    expect(element.props.workItem.project_name).toBe('Project A');
    expect(element.props.workItem.phase_name).toBe('Phase 2');
    expect(element.props.workItem.task_name).toBe('Build feature');
    expect(element.props.workItem.service_id).toBe('service-1');
    expect(element.props.workItem.service_name).toBe('Implementation');
  });
});
