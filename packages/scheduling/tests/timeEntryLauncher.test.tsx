import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchTimeEntryForWorkItem } from '../src/lib/timeEntryLauncher';

// Launcher construction coverage: the work item handed to whichever stage opens
// keeps ticket/project/interaction context, and existing entries route to their
// saved sheet instead of the period picker. Behavioral feedback lives in
// timeEntryLauncher.launchFeedback.test.ts; rendered picker behavior lives in
// timeEntryPeriodLauncher.test.tsx.

const {
  getCurrentUser,
  getCurrentTimePeriod,
  getTimeEntryUserTimeZone,
  fetchTimePeriods,
  fetchOrCreateTimeSheet,
  getTimeEntryById,
  fetchTimeSheet,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCurrentTimePeriod: vi.fn(),
  getTimeEntryUserTimeZone: vi.fn(),
  fetchTimePeriods: vi.fn(),
  fetchOrCreateTimeSheet: vi.fn(),
  getTimeEntryById: vi.fn(),
  fetchTimeSheet: vi.fn(),
}));

vi.mock('@alga-psa/users/actions', () => ({ getCurrentUser }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser }));

vi.mock('../src/actions/timePeriodsActions', () => ({
  getCurrentTimePeriod,
  getTimeEntryUserTimeZone,
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchTimePeriods,
  fetchOrCreateTimeSheet,
  saveTimeEntry: vi.fn(),
  getTimeEntryById,
}));

vi.mock('../src/actions/timeSheetActions', () => ({ fetchTimeSheet }));

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), success: vi.fn() } }));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntryDialog', () => ({
  default: () => null,
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntryPeriodLauncher', () => ({
  default: () => null,
}));

// The drawer receives a React element but never renders it here, so read the
// props off the element rather than from a component body.
const openedProps = (openDrawer: ReturnType<typeof vi.fn>): any => openDrawer.mock.calls[0][0].props;

const periods = [
  { period_id: 'period-1', start_date: '2026-09-01', end_date: '2026-09-08', timeSheetStatus: 'DRAFT', timeSheetId: 'sheet-1' },
];

beforeEach(() => {
  getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  getCurrentTimePeriod.mockResolvedValue({ period_id: 'period-1', start_date: '2026-09-01', end_date: '2026-09-08' });
  getTimeEntryUserTimeZone.mockResolvedValue('America/New_York');
  fetchTimePeriods.mockResolvedValue(periods);
  fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-1' });
  getTimeEntryById.mockResolvedValue(null);
});

describe('launchTimeEntryForWorkItem', () => {
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

    const workItem = openedProps(openDrawer).workItem;
    expect(workItem.work_item_id).toBe('ticket-1');
    expect(workItem.type).toBe('ticket');
    expect(workItem.name).toBe('Ticket 1');
    expect(workItem.ticket_number).toBe('T-123');
    expect(workItem.client_name).toBe('Acme');
    expect(workItem.description).toBe('Worked on issue');
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

    const workItem = openedProps(openDrawer).workItem;
    expect(workItem.work_item_id).toBe('interaction-1');
    expect(workItem.type).toBe('interaction');
    expect(workItem.interaction_type).toBe('Call');
    expect(workItem.client_name).toBe('Globex');
    expect(workItem.startTime).toEqual(start);
    expect(workItem.endTime).toEqual(end);
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

    const workItem = openedProps(openDrawer).workItem;
    expect(workItem.type).toBe('project_task');
    expect(workItem.project_name).toBe('Project A');
    expect(workItem.phase_name).toBe('Phase 2');
    expect(workItem.task_name).toBe('Build feature');
    expect(workItem.service_id).toBe('service-1');
    expect(workItem.service_name).toBe('Implementation');
  });

  it('routes existing entries to their saved sheet without creating today’s sheet', async () => {
    getTimeEntryById.mockResolvedValueOnce({
      entry_id: 'entry-1',
      time_sheet_id: 'sheet-old',
      start_time: '2026-02-10T14:00:00.000Z',
      end_time: '2026-02-10T15:00:00.000Z',
    });
    fetchTimeSheet.mockResolvedValueOnce({
      id: 'sheet-old',
      approval_status: 'DRAFT',
      tenant: 'tenant-1',
      time_period: { period_id: 'period-old', start_date: '2026-02-01', end_date: '2026-02-08' },
    });
    const openDrawer = vi.fn();

    await launchTimeEntryForWorkItem({
      openDrawer,
      closeDrawer: vi.fn(),
      existingEntryId: 'entry-1',
      context: { workItemId: 'ticket-9', workItemType: 'ticket', workItemName: 'Ticket 9' },
    });

    expect(fetchOrCreateTimeSheet).not.toHaveBeenCalled();
    const props = openedProps(openDrawer);
    expect(props.existingEntries[0].entry_id).toBe('entry-1');
    expect(props.timeSheetId).toBe('sheet-old');
  });
});
