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
    start_time: '2026-04-12T09:00:00',
    end_time: '2026-04-12T10:00:00',
    created_at: '2026-04-12T10:00:00',
    updated_at: '2026-04-12T10:00:00',
    billable_duration: 60,
    notes: 'Follow up',
    user_id: 'user-1',
    time_sheet_id: 'sheet-1',
    approval_status: 'DRAFT',
    tenant: 'tenant-1',
    work_date: '2026-04-12',
    workItem: {
      work_item_id: 'work-item-1',
      name: 'Missing White Rabbit',
      type: 'ticket',
      description: '',
      ticket_number: 'TIC1001',
      is_billable: true,
    },
    ...overrides,
  };
}

describe('TimeSheetListView focus filter mode', () => {
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
    dates: [new Date(2026, 3, 12), new Date(2026, 3, 13)],
    workItemsByType: {
      ticket: [
        {
          work_item_id: 'work-item-1',
          name: 'Missing White Rabbit',
          type: 'ticket',
          description: '',
          ticket_number: 'TIC1001',
          is_billable: true,
        },
      ],
    },
    isEditable: true,
    onDeleteWorkItem: vi.fn(async () => undefined),
    onAddWorkItem: vi.fn(),
    onWorkItemClick: vi.fn(),
    onCellClick: vi.fn(),
  };

  it('shows only the filtered entries and exposes clear/back actions', async () => {
    const onClearFocusFilter = vi.fn();
    const onBackToGrid = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(TimeSheetListView, {
          ...commonProps,
          groupedTimeEntries: {
            'work-item-1': [
              createEntry({ entry_id: 'entry-1', notes: 'First entry' }),
              createEntry({
                entry_id: 'entry-2',
                start_time: '2026-04-12T10:00:00',
                end_time: '2026-04-12T11:00:00',
                notes: 'Second entry',
              }),
              createEntry({
                entry_id: 'entry-3',
                start_time: '2026-04-13T09:00:00',
                end_time: '2026-04-13T10:00:00',
                work_date: '2026-04-13',
                notes: 'Other day entry',
              }),
            ],
          },
          focusFilter: {
            workItemId: 'work-item-1',
            workItemLabel: 'TIC1001 - Missing White Rabbit',
            date: '2026-04-12',
            dateLabel: 'Apr 12',
            entryIds: ['entry-2'],
            entryCount: 1,
          },
          onClearFocusFilter,
          onBackToGrid,
        }),
      );
    });

    await flushUi();
    await flushUi();

    const rows = container.querySelectorAll('[data-automation-id^="time-entry-row-"]');
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain('Second entry');
    expect(container.textContent).not.toContain('First entry');
    expect(container.textContent).not.toContain('Other day entry');
    expect(container.textContent).toContain('Showing 1 entries for TIC1001 - Missing White Rabbit on Apr 12');

    const clearButton = container.querySelector('#clear-time-entry-focus-filter-button');
    const backButton = container.querySelector('#back-to-grid-view-button');
    if (!clearButton || !backButton) {
      throw new Error('Expected focus filter actions');
    }

    clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    backButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClearFocusFilter).toHaveBeenCalledTimes(1);
    expect(onBackToGrid).toHaveBeenCalledTimes(1);
  });
});
