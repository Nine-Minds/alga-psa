// @vitest-environment jsdom
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    title,
    id,
  }: {
    children: React.ReactNode;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    title?: string;
    id?: string;
  }) => React.createElement('button', { type: 'button', onClick, disabled, title, id }, children),
}), { virtual: true });

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}), { virtual: true });

vi.mock('@alga-psa/ui/components/skeletons/TimeSheetListViewSkeleton', () => ({
  __esModule: true,
  default: () => React.createElement('div', null, 'loading'),
}), { virtual: true });

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {} }),
}), { virtual: true });

vi.mock('@alga-psa/ui/ui-reflection/actionBuilders', () => ({
  CommonActions: {
    focus: () => ({ type: 'focus' }),
  },
}), { virtual: true });

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}), { virtual: true });

const { TimeSheetListView } = await import('../src/components/time-management/time-entry/time-sheet/TimeSheetListView');

function createEntry(overrides: Record<string, unknown> = {}) {
  return {
    entry_id: 'entry-1',
    work_item_id: 'work-item-1',
    work_item_type: 'ticket',
    start_time: '2026-03-10T09:00:00',
    end_time: '2026-03-10T10:00:00',
    created_at: '2026-03-10T10:00:00',
    updated_at: '2026-03-10T10:00:00',
    billable_duration: 60,
    notes: 'Follow up',
    user_id: 'user-1',
    time_sheet_id: 'sheet-1',
    approval_status: 'DRAFT',
    tenant: 'tenant-1',
    work_date: '2026-03-10',
    workItem: {
      work_item_id: 'work-item-1',
      name: 'Ticket 1001',
      type: 'ticket',
      description: '',
      ticket_number: '1001',
      is_billable: true,
    },
    ...overrides,
  };
}

describe('TimeSheetListView feedback markers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  async function flushUi() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const commonProps = {
    dates: [new Date(2026, 2, 10)],
    workItemsByType: {
      ticket: [
        {
          work_item_id: 'work-item-1',
          name: 'Ticket 1001',
          type: 'ticket',
          description: '',
          ticket_number: '1001',
          is_billable: true,
        },
      ],
    },
    isEditable: false,
    onDeleteWorkItem: vi.fn(async () => undefined),
    onAddWorkItem: vi.fn(),
    onWorkItemClick: vi.fn(),
  };

  it('T013/T019: shows an unresolved marker and keeps row clicks bound to entry editing', async () => {
    const onCellClick = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetListView, {
          ...commonProps,
          groupedTimeEntries: {
            'work-item-1': [
              createEntry({
                change_requests: [
                  {
                    change_request_id: 'cr-1',
                    time_entry_id: 'entry-1',
                    time_sheet_id: 'sheet-1',
                    comment: 'Please separate travel time.',
                    created_at: '2026-03-10T11:00:00.000Z',
                    created_by: 'manager-1',
                    tenant: 'tenant-1',
                  },
                ],
                change_request_state: 'unresolved',
              }),
            ],
          },
          onCellClick,
        }),
      );
    });

    await flushUi();
    await flushUi();

    expect(container.querySelector('[data-feedback-state="unresolved"]')).not.toBeNull();

    const row = container.querySelector('[data-automation-id="time-entry-row-entry-1"]');
    if (!row) {
      throw new Error('Expected time entry row');
    }

    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });

  it('T014: shows a handled marker when the latest change request was addressed', async () => {
    flushSync(() => {
      root.render(
        React.createElement(TimeSheetListView, {
          ...commonProps,
          groupedTimeEntries: {
            'work-item-1': [
              createEntry({
                change_requests: [
                  {
                    change_request_id: 'cr-1',
                    time_entry_id: 'entry-1',
                    time_sheet_id: 'sheet-1',
                    comment: 'Updated.',
                    created_at: '2026-03-10T11:00:00.000Z',
                    created_by: 'manager-1',
                    handled_at: '2026-03-10T13:00:00.000Z',
                    handled_by: 'user-1',
                    tenant: 'tenant-1',
                  },
                ],
                change_request_state: 'handled',
              }),
            ],
          },
          onCellClick: vi.fn(),
        }),
      );
    });

    await flushUi();
    await flushUi();

    expect(container.querySelector('[data-feedback-state="handled"]')).not.toBeNull();
  });

  it('T015: shows no feedback marker for entries without feedback history', async () => {
    flushSync(() => {
      root.render(
        React.createElement(TimeSheetListView, {
          ...commonProps,
          groupedTimeEntries: {
            'work-item-1': [createEntry()],
          },
          onCellClick: vi.fn(),
        }),
      );
    });

    await flushUi();

    expect(container.querySelector('[data-feedback-state]')).toBeNull();
  });

  it('re-expands a collapsed day when that day receives unresolved approval feedback', async () => {
    const onCellClick = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetListView, {
          ...commonProps,
          dates: [new Date(2026, 2, 10), new Date(2026, 2, 11)],
          groupedTimeEntries: {
            'work-item-1': [
              createEntry({
                entry_id: 'entry-1',
                start_time: '2026-03-10T09:00:00',
                end_time: '2026-03-10T10:00:00',
                work_date: '2026-03-10',
              }),
              createEntry({
                entry_id: 'entry-2',
                start_time: '2026-03-11T09:00:00',
                end_time: '2026-03-11T10:00:00',
                work_date: '2026-03-11',
              }),
            ],
          },
          onCellClick,
        }),
      );
    });

    await flushUi();
    await flushUi();

    const secondDayHeader = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('Wed, Mar 11'),
    );

    if (!secondDayHeader) {
      throw new Error('Expected second day header row');
    }

    secondDayHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushUi();

    expect(container.querySelector('[data-automation-id="time-entry-row-entry-2"]')).toBeNull();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetListView, {
          ...commonProps,
          dates: [new Date(2026, 2, 10), new Date(2026, 2, 11)],
          groupedTimeEntries: {
            'work-item-1': [
              createEntry({
                entry_id: 'entry-1',
                start_time: '2026-03-10T09:00:00',
                end_time: '2026-03-10T10:00:00',
                work_date: '2026-03-10',
              }),
              createEntry({
                entry_id: 'entry-2',
                start_time: '2026-03-11T09:00:00',
                end_time: '2026-03-11T10:00:00',
                work_date: '2026-03-11',
                approval_status: 'CHANGES_REQUESTED',
                change_request_state: 'unresolved',
                change_requests: [
                  {
                    change_request_id: 'cr-2',
                    time_entry_id: 'entry-2',
                    time_sheet_id: 'sheet-1',
                    comment: 'Please clarify the billing split.',
                    created_at: '2026-03-11T11:00:00.000Z',
                    created_by: 'manager-1',
                    tenant: 'tenant-1',
                  },
                ],
              }),
            ],
          },
          onCellClick,
        }),
      );
    });

    await flushUi();
    await flushUi();

    expect(container.querySelector('[data-automation-id="time-entry-row-entry-2"]')).not.toBeNull();
  });
});
