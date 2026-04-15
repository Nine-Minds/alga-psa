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

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}), { virtual: true });

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}), { virtual: true });

const { TimeSheetTable } = await import('../src/components/time-management/time-entry/time-sheet/TimeSheetTable');

describe('TimeSheetTable quick add interaction state', () => {
  let container: HTMLDivElement;
  let root: Root;

  const workItem = {
    work_item_id: 'work-item-1',
    name: 'Ticket 1001',
    type: 'ticket',
    description: '',
    ticket_number: '1001',
    is_billable: true,
  };

  const commonProps = {
    dates: [new Date(2026, 2, 10)],
    workItemsByType: {
      ticket: [workItem],
    },
    groupedTimeEntries: {
      'work-item-1': [],
    },
    isEditable: true,
    onDeleteWorkItem: vi.fn(async () => undefined),
    onAddEntryForCell: vi.fn(),
    onAddWorkItem: vi.fn(),
    onWorkItemClick: vi.fn(),
    onDateNavigatorChange: vi.fn(),
  };

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'offsetWidth', { value: 900, configurable: true });
    document.body.innerHTML = '';
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('renders deterministic quick-add editor controls for the active cell', () => {
    flushSync(() => {
      root.render(
        React.createElement(TimeSheetTable, {
          ...commonProps,
          onCellClick: vi.fn(),
          activeQuickAdd: {
            workItem,
            date: '2026-03-10',
            value: '1:30',
          },
          onActivateQuickAdd: vi.fn(),
          onQuickAddValueChange: vi.fn(),
          onQuickAddCancel: vi.fn(),
          onQuickAddSubmit: vi.fn(async () => undefined),
        }),
      );
    });

    expect(container.querySelector('#timesheet-quick-input-work-item-1-2026-03-10')).not.toBeNull();
    expect(container.querySelector('#timesheet-quick-save-work-item-1-2026-03-10')).not.toBeNull();
    expect(container.querySelector('#timesheet-quick-cancel-work-item-1-2026-03-10')).not.toBeNull();
  });

  it('keeps quick-add button clicks isolated while the add-area still opens the dialog path', () => {
    const onCellClick = vi.fn();
    const onAddEntryForCell = vi.fn();
    const onQuickAddSubmit = vi.fn(async () => undefined);
    const onQuickAddCancel = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetTable, {
          ...commonProps,
          onCellClick,
          onAddEntryForCell,
          activeQuickAdd: {
            workItem,
            date: '2026-03-10',
            value: '2',
          },
          onActivateQuickAdd: vi.fn(),
          onQuickAddValueChange: vi.fn(),
          onQuickAddCancel,
          onQuickAddSubmit,
        }),
      );
    });

    const saveButton = container.querySelector('#timesheet-quick-save-work-item-1-2026-03-10');
    const cancelButton = container.querySelector('#timesheet-quick-cancel-work-item-1-2026-03-10');
    const addArea = container.querySelector('[data-automation-id="time-cell-add-area-work-item-1-2026-03-10"]');

    if (!saveButton || !cancelButton || !addArea) {
      throw new Error('Expected quick add controls and add area');
    }

    flushSync(() => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onQuickAddSubmit).toHaveBeenCalledTimes(1);
    expect(onCellClick).not.toHaveBeenCalled();
    expect(onAddEntryForCell).not.toHaveBeenCalled();

    flushSync(() => {
      cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onQuickAddCancel).toHaveBeenCalledTimes(1);
    expect(onCellClick).not.toHaveBeenCalled();
    expect(onAddEntryForCell).not.toHaveBeenCalled();

    flushSync(() => {
      addArea.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAddEntryForCell).toHaveBeenCalledTimes(1);
    expect(onCellClick).not.toHaveBeenCalled();
  });
});
