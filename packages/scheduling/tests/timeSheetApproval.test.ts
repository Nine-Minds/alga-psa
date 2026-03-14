// @vitest-environment jsdom
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
vi.mock('../src/actions/timeSheetActions', () => ({
  addCommentToTimeSheet,
  fetchTimeSheetComments,
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
  });

  async function flushUi() {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  it('updates entry approval status without requiring service_id in the approval drawer flow', async () => {
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
    });

    root.unmount();
    container.remove();
  });
});
