// @vitest-environment jsdom
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimeEntryChangeRequestPanel } from '../src/components/time-management/time-entry/time-sheet/TimeEntryChangeRequestFeedback';

describe('TimeEntryChangeRequestPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('T008: shows the latest feedback banner when an entry has approver feedback', () => {
    flushSync(() => {
      root.render(
        React.createElement(TimeEntryChangeRequestPanel, {
          changeRequests: [
            {
              change_request_id: 'older',
              time_entry_id: 'entry-1',
              time_sheet_id: 'sheet-1',
              comment: 'Older feedback',
              created_at: '2026-03-10T09:00:00.000Z',
              created_by: 'manager-1',
              created_by_name: 'Grace Hopper',
              tenant: 'tenant-1',
            },
            {
              change_request_id: 'latest',
              time_entry_id: 'entry-1',
              time_sheet_id: 'sheet-1',
              comment: 'Please split the travel and onsite work.',
              created_at: '2026-03-11T09:00:00.000Z',
              created_by: 'manager-1',
              created_by_name: 'Grace Hopper',
              tenant: 'tenant-1',
            },
          ],
        }),
      );
    });

    expect(container.textContent).toContain('Approver feedback');
    expect(container.textContent).toContain('Please split the travel and onsite work.');
    expect(container.textContent).toContain('View feedback history');
  });

  it('T009: hides the feedback banner when an entry has no feedback', () => {
    flushSync(() => {
      root.render(React.createElement(TimeEntryChangeRequestPanel, { changeRequests: [] }));
    });

    expect(container.textContent?.trim()).toBe('');
  });

  it('T010/T011: renders expandable history for multiple records in chronological order', () => {
    flushSync(() => {
      root.render(
        React.createElement(TimeEntryChangeRequestPanel, {
          changeRequests: [
            {
              change_request_id: 'first',
              time_entry_id: 'entry-1',
              time_sheet_id: 'sheet-1',
              comment: 'First note',
              created_at: '2026-03-10T09:00:00.000Z',
              created_by: 'manager-1',
              created_by_name: 'Grace Hopper',
              handled_at: '2026-03-10T12:00:00.000Z',
              handled_by: 'user-1',
              tenant: 'tenant-1',
            },
            {
              change_request_id: 'second',
              time_entry_id: 'entry-1',
              time_sheet_id: 'sheet-1',
              comment: 'Second note',
              created_at: '2026-03-11T09:00:00.000Z',
              created_by: 'manager-1',
              created_by_name: 'Grace Hopper',
              tenant: 'tenant-1',
            },
          ],
        }),
      );
    });

    const details = container.querySelector('details');
    if (!details) {
      throw new Error('Expected feedback history details element');
    }

    details.open = true;

    const panelText = container.textContent ?? '';
    expect(panelText).toContain('View feedback history');
    const historyBodies = Array.from(details.querySelectorAll('p'))
      .map((node) => node.textContent ?? '')
      .filter((text) => text === 'First note' || text === 'Second note');
    expect(historyBodies).toEqual(['First note', 'Second note']);
    expect(container.querySelector('[data-feedback-state="handled"]')).not.toBeNull();
    expect(container.querySelector('[data-feedback-state="unresolved"]')).not.toBeNull();
  });
});
