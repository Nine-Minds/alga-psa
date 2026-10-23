/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EVENT_A = '33333333-3333-4333-8333-333333333333';
const EVENT_B = '44444444-4444-4444-8444-444444444444';

const actionMocks = vi.hoisted(() => ({
  exportWorkflowEventsAction: vi.fn(),
  getWorkflowEventAction: vi.fn(),
  listWorkflowEventSummaryAction: vi.fn(),
  listWorkflowEventsPagedAction: vi.fn(),
  listEventLaunchSkipsAction: vi.fn(),
}));

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => navigationMocks.searchParams,
}));

vi.mock('@alga-psa/workflows/actions', () => actionMocks);
vi.mock('@alga-psa/workflows/hooks/useWorkflowEnumOptions', () => ({
  useFormatWorkflowEventStatus: () => (value: string) => value,
  useWorkflowEventStatusOptions: () => [],
}));
vi.mock('../../workflow-run-studio/WorkflowRunDetailsPanel', () => ({ __esModule: true, default: () => null }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../workflowServerErrors', () => ({ mapWorkflowServerError: (e: unknown) => String(e) }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, onRowClick }: { data: Array<{ event_id: string }>; onRowClick: (row: unknown) => void }) => (
    <div>
      {data.map((row) => (
        <button key={row.event_id} id={`row-${row.event_id}`} onClick={() => onRowClick(row)}>
          row
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({ SearchInput: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useFormatters: () => ({ formatDate: (value: unknown) => String(value) }),
}));

import WorkflowEventList from '../WorkflowEventList';

const eventRecord = (id: string, name: string) => ({
  event: { event_id: id, event_name: name, created_at: '2026-10-09T10:00:00.000Z', status: 'matched' },
  wait: null,
  run: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/msp/workflow-control');
  navigationMocks.searchParams = new URLSearchParams({ section: 'events', eventId: EVENT_A });
  actionMocks.listWorkflowEventsPagedAction.mockResolvedValue({
    items: [{ event_id: EVENT_B, event_name: 'B', status: 'matched', created_at: '2026-10-09T10:00:00.000Z' }],
    totalItems: 1,
  });
  actionMocks.listWorkflowEventSummaryAction.mockResolvedValue({ total: 0, matched: 0, unmatched: 0, error: 0 });
  actionMocks.listEventLaunchSkipsAction.mockResolvedValue([]);
  actionMocks.getWorkflowEventAction.mockImplementation(async ({ eventId }: { eventId: string }) =>
    eventRecord(eventId, eventId === EVENT_A ? 'EVENT_ALPHA' : 'EVENT_BETA')
  );
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('WorkflowEventList URL-driven selection', () => {
  it('Close removes eventId and keeps section', async () => {
    render(<WorkflowEventList isActive />);
    fireEvent.click(await screen.findByText('Close'));
    expect(navigationMocks.replace).toHaveBeenCalledWith('/msp/workflow-control?section=events', { scroll: false });
  });

  it('Back removes eventId and keeps section', async () => {
    render(<WorkflowEventList isActive />);
    fireEvent.click(await screen.findByText('Back to events'));
    expect(navigationMocks.replace).toHaveBeenCalledWith('/msp/workflow-control?section=events', { scroll: false });
  });

  it('a row click writes eventId and keeps section', async () => {
    navigationMocks.searchParams = new URLSearchParams({ section: 'events' });
    render(<WorkflowEventList isActive />);
    fireEvent.click(await screen.findByRole('button', { name: 'row' }));
    expect(navigationMocks.replace).toHaveBeenCalledWith(
      `/msp/workflow-control?section=events&eventId=${EVENT_B}`,
      { scroll: false }
    );
  });

  it('swaps the detail when eventId changes while mounted', async () => {
    const { rerender } = render(<WorkflowEventList isActive />);
    expect(await screen.findByText('EVENT_ALPHA')).toBeInTheDocument();

    navigationMocks.searchParams = new URLSearchParams({ section: 'events', eventId: EVENT_B });
    rerender(<WorkflowEventList isActive />);

    await waitFor(() => expect(screen.getByText('EVENT_BETA')).toBeInTheDocument());
    expect(screen.queryByText('EVENT_ALPHA')).not.toBeInTheDocument();
  });
});
