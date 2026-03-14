// @vitest-environment jsdom
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
}), { virtual: true });

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, title, onClick, disabled }: { children: React.ReactNode; title?: string; onClick?: () => void; disabled?: boolean }) =>
    React.createElement('button', { type: 'button', title, onClick, disabled }, children),
}), { virtual: true });

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CardHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  CardTitle: ({ children }: { children: React.ReactNode }) => React.createElement('h3', null, children),
  CardContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}), { virtual: true });

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    placeholder?: string;
  }) => React.createElement('textarea', {
    value,
    placeholder,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.({ target: { value: event.target.value } }),
  }),
}), { virtual: true });

const addCommentToTimeSheet = vi.fn();
const fetchTimeSheetComments = vi.fn();
const requestChangesForTimeSheet = vi.fn();
vi.mock('../src/actions/timeSheetActions', () => ({
  addCommentToTimeSheet,
  fetchTimeSheetComments,
  requestChangesForTimeSheet,
}));

const fetchWorkItemsForTimeSheet = vi.fn();
const updateTimeEntryApprovalStatus = vi.fn();
vi.mock('../src/actions/timeEntryActions', () => ({
  fetchWorkItemsForTimeSheet,
  updateTimeEntryApprovalStatus,
}));

const { TimeSheetApproval } = await import('../src/components/time-management/approvals/TimeSheetApproval');

describe('TimeSheetApproval', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    addCommentToTimeSheet.mockReset();
    fetchTimeSheetComments.mockReset();
    fetchWorkItemsForTimeSheet.mockReset();
    updateTimeEntryApprovalStatus.mockReset();
    requestChangesForTimeSheet.mockReset();

    fetchTimeSheetComments.mockResolvedValue([]);
    fetchWorkItemsForTimeSheet.mockResolvedValue([
      {
        work_item_id: 'ticket-1',
        type: 'ticket',
        name: 'Ticket 1',
        description: 'Ticket description',
      },
    ]);
    updateTimeEntryApprovalStatus.mockResolvedValue(undefined);
    requestChangesForTimeSheet.mockResolvedValue(undefined);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  async function flushUi() {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  function renderApprovalDrawer() {
    flushSync(() => {
      root.render(React.createElement(TimeSheetApproval, {
        timeSheet: {
          id: 'sheet-1',
          period_id: 'period-1',
          user_id: 'user-1',
          approval_status: 'SUBMITTED',
          employee_name: 'Ada Lovelace',
          employee_email: 'ada@example.com',
          comments: [],
          tenant: 'tenant-1',
          time_period: {
            period_id: 'period-1',
            start_date: '2026-03-01',
            end_date: '2026-03-07',
            tenant: 'tenant-1',
          },
        },
        timeEntries: [
          {
            entry_id: 'entry-1',
            work_item_id: 'ticket-1',
            work_item_type: 'ticket',
            start_time: '2026-03-02T09:00:00.000Z',
            end_time: '2026-03-02T10:00:00.000Z',
            created_at: '2026-03-02T10:00:00.000Z',
            updated_at: '2026-03-02T10:00:00.000Z',
            billable_duration: 60,
            notes: 'Needs follow-up',
            user_id: 'user-1',
            time_sheet_id: 'sheet-1',
            approval_status: 'SUBMITTED',
            tenant: 'tenant-1',
          },
        ],
        currentUser: {
          user_id: 'manager-1',
          first_name: 'Grace',
          last_name: 'Hopper',
          email: 'grace@example.com',
          username: 'ghopper',
          is_inactive: false,
          tenant: 'tenant-1',
          user_type: 'internal',
        },
        onApprove: vi.fn(),
        onRequestChanges: vi.fn(),
      }));
    });
  }

  it('T001: renders a dedicated entry-level change suggestion input', async () => {
    renderApprovalDrawer();

    await flushUi();

    const toggleButton = container.querySelector('button[title="Show Details"]');
    if (!toggleButton) {
      throw new Error('Show Details button not found');
    }
    toggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    expect(container.textContent).toContain('Entry Change Suggestion');
    expect(container.querySelector('textarea')?.getAttribute('placeholder')).toContain('Tell the employee exactly what to fix');
  });

  it('updates entry approval status without requiring service_id in the approval drawer flow', async () => {
    renderApprovalDrawer();

    await flushUi();
    expect(fetchWorkItemsForTimeSheet).toHaveBeenCalledWith('sheet-1');

    const toggleButton = container.querySelector('button[title="Show Details"]');
    if (!toggleButton) {
      throw new Error('Show Details button not found');
    }
    toggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    const requestChangesButton = Array.from(container.querySelectorAll('button')).find(
      node => node.textContent?.includes('Request Changes'),
    );
    if (!requestChangesButton) {
      throw new Error('Request Changes button not found');
    }
    requestChangesButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    expect(updateTimeEntryApprovalStatus).toHaveBeenCalledWith({
      entryId: 'entry-1',
      approvalStatus: 'CHANGES_REQUESTED',
      changeRequestComment: undefined,
    });
    expect(requestChangesForTimeSheet).toHaveBeenCalledWith('sheet-1', 'manager-1');
  });

  it('T002/T033: submits the entry id together with the optional suggestion and still supports an empty suggestion', async () => {
    renderApprovalDrawer();

    await flushUi();

    const toggleButton = container.querySelector('button[title="Show Details"]');
    if (!toggleButton) {
      throw new Error('Show Details button not found');
    }
    toggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    const suggestionInput = container.querySelector('textarea');
    if (!suggestionInput) {
      throw new Error('Suggestion input not found');
    }

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;

    valueSetter?.call(suggestionInput, 'Please break out travel time separately.');
    suggestionInput.dispatchEvent(new Event('input', { bubbles: true }));
    suggestionInput.dispatchEvent(new Event('change', { bubbles: true }));
    await flushUi();

    let requestChangesButton = Array.from(container.querySelectorAll('button')).find(
      node => node.textContent?.includes('Request Changes'),
    );
    if (!requestChangesButton) {
      throw new Error('Request Changes button not found');
    }
    requestChangesButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    expect(updateTimeEntryApprovalStatus).toHaveBeenLastCalledWith({
      entryId: 'entry-1',
      approvalStatus: 'CHANGES_REQUESTED',
      changeRequestComment: 'Please break out travel time separately.',
    });

    updateTimeEntryApprovalStatus.mockClear();

    root.unmount();
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    renderApprovalDrawer();
    await flushUi();

    const freshToggleButton = container.querySelector('button[title="Show Details"]');
    if (!freshToggleButton) {
      throw new Error('Show Details button not found');
    }
    freshToggleButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    requestChangesButton = Array.from(container.querySelectorAll('button')).find(
      node => node.textContent?.includes('Request Changes'),
    );
    if (!requestChangesButton) {
      throw new Error('Request Changes button not found');
    }
    requestChangesButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    expect(updateTimeEntryApprovalStatus).toHaveBeenLastCalledWith({
      entryId: 'entry-1',
      approvalStatus: 'CHANGES_REQUESTED',
      changeRequestComment: undefined,
    });
  });
});
