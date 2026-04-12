// @vitest-environment jsdom
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverMock,
  configurable: true,
});

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

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({
    value,
    onChange,
    onClick,
    onKeyDown,
    onBlur,
    placeholder,
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    onClick?: (event: React.MouseEvent<HTMLInputElement>) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
    placeholder?: string;
  }) => React.createElement('input', { value, onChange, onClick, onKeyDown, onBlur, placeholder }),
}), { virtual: true });

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
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

const { TimeSheetTable } = await import('../src/components/time-management/time-entry/time-sheet/TimeSheetTable');

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

describe('TimeSheetTable feedback markers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'offsetWidth', { value: 900, configurable: true });
    document.body.appendChild(container);
    root = createRoot(container);
  });

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
    onAddEntryForCell: vi.fn(),
    onAddWorkItem: vi.fn(),
    onWorkItemClick: vi.fn(),
    onQuickAddTimeEntry: vi.fn(async () => undefined),
  };

  it('T016/T020: shows an X marker for unresolved feedback and preserves cell click behavior', () => {
    const onCellClick = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetTable, {
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

    const marker = container.querySelector('[data-feedback-state="unresolved"]');
    expect(marker).not.toBeNull();

    const entrySummary = container.querySelector('[data-automation-id="time-cell-entry-work-item-1-2026-03-10"]');
    if (!entrySummary) {
      throw new Error('Expected time entry summary');
    }

    entrySummary.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });

  it('T017: shows a check marker when the latest cell feedback was handled', () => {
    flushSync(() => {
      root.render(
        React.createElement(TimeSheetTable, {
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

    expect(container.querySelector('[data-feedback-state="handled"]')).not.toBeNull();
  });

  it('T018: shows no icon when the cell has no entry-level feedback', () => {
    flushSync(() => {
      root.render(
        React.createElement(TimeSheetTable, {
          ...commonProps,
          groupedTimeEntries: {
            'work-item-1': [createEntry()],
          },
          onCellClick: vi.fn(),
        }),
      );
    });

    expect(container.querySelector('[data-feedback-state]')).toBeNull();
  });

  it('opens the existing entry when the entry summary is clicked', () => {
    const onCellClick = vi.fn();
    const onAddEntryForCell = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetTable, {
          ...commonProps,
          isEditable: true,
          groupedTimeEntries: {
            'work-item-1': [createEntry()],
          },
          onCellClick,
          onAddEntryForCell,
        }),
      );
    });

    const entrySummary = container.querySelector('[data-automation-id="time-cell-entry-work-item-1-2026-03-10"]');
    if (!entrySummary) {
      throw new Error('Expected time entry summary');
    }

    entrySummary.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onAddEntryForCell).not.toHaveBeenCalled();
  });

  it('treats the surrounding cell area as add-entry space when editable', () => {
    const onCellClick = vi.fn();
    const onAddEntryForCell = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetTable, {
          ...commonProps,
          isEditable: true,
          groupedTimeEntries: {
            'work-item-1': [createEntry()],
          },
          onCellClick,
          onAddEntryForCell,
        }),
      );
    });

    const addArea = container.querySelector('[data-automation-id="time-cell-add-area-work-item-1-2026-03-10"]');
    if (!addArea) {
      throw new Error('Expected time entry add area');
    }

    addArea.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onAddEntryForCell).toHaveBeenCalledTimes(1);
    expect(onCellClick).not.toHaveBeenCalled();
  });
});
