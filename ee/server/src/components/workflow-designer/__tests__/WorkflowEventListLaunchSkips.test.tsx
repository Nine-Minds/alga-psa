/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const EVENT_ID = '33333333-3333-4333-8333-333333333333';

const actionMocks = vi.hoisted(() => ({
  exportWorkflowEventsAction: vi.fn(),
  getWorkflowEventAction: vi.fn(),
  listWorkflowEventSummaryAction: vi.fn(),
  listWorkflowEventsPagedAction: vi.fn(),
  listEventLaunchSkipsAction: vi.fn(),
}));

vi.mock('@alga-psa/workflows/actions', () => actionMocks);
vi.mock('@alga-psa/workflows/hooks/useWorkflowEnumOptions', () => ({
  useFormatWorkflowEventStatus: () => (value: string) => value,
  useWorkflowEventStatusOptions: () => [],
}));
vi.mock('../../workflow-run-studio/WorkflowRunDetailsPanel', () => ({ __esModule: true, default: () => null }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../workflowServerErrors', () => ({ mapWorkflowServerError: (e: unknown) => String(e) }));
vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/SearchInput', () => ({ SearchInput: () => null }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
  useFormatters: () => ({ formatDate: (value: unknown) => String(value) }),
}));

import WorkflowEventList from '../WorkflowEventList';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', `/?eventId=${EVENT_ID}`);
  actionMocks.listWorkflowEventsPagedAction.mockResolvedValue({ items: [], totalItems: 0 });
  actionMocks.listWorkflowEventSummaryAction.mockResolvedValue({ total: 0, matched: 0, unmatched: 0, error: 0 });
  actionMocks.getWorkflowEventAction.mockResolvedValue({
    event: {
      event_id: EVENT_ID,
      event_name: 'TICKET_CREATED',
      created_at: '2026-10-09T10:00:00.000Z',
      status: 'unmatched',
      error_message: 'Workflow "Escalate": payload mismatch',
    },
    wait: null,
    run: null,
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('WorkflowEventList "Workflows not launched" section', () => {
  it('lists skipped workflows with name, reason, message, and an intentional tag, keeping the error line', async () => {
    actionMocks.listEventLaunchSkipsAction.mockResolvedValue([
      {
        workflowName: 'Escalate',
        workflowKey: 'escalate',
        reason: 'schema_mismatch',
        intentional: false,
        message: 'Payload does not match the schema',
        details: null,
      },
      {
        workflowName: 'Paused flow',
        workflowKey: 'paused-flow',
        reason: 'paused',
        intentional: true,
        message: 'Workflow is paused',
        details: null,
      },
    ]);

    render(<WorkflowEventList isActive />);

    const section = await waitFor(() => {
      const el = document.getElementById('workflow-event-detail-launch-skips');
      expect(el).toBeInTheDocument();
      return el as HTMLElement;
    });

    expect(actionMocks.listEventLaunchSkipsAction).toHaveBeenCalledWith({ eventId: EVENT_ID });
    expect(within(section).getByText('Workflows not launched')).toBeInTheDocument();
    expect(within(section).getByText('Escalate')).toBeInTheDocument();
    expect(within(section).getByText('schema_mismatch')).toBeInTheDocument();
    expect(within(section).getByText('Payload does not match the schema')).toBeInTheDocument();
    expect(within(section).getByText('Paused flow')).toBeInTheDocument();
    expect(within(section).getAllByText('Intentional')).toHaveLength(1);
    // Existing error_message line is untouched.
    expect(screen.getByText('Error: Workflow "Escalate": payload mismatch')).toBeInTheDocument();
  });

  it('renders no section when the event has no skips', async () => {
    actionMocks.listEventLaunchSkipsAction.mockResolvedValue([]);
    render(<WorkflowEventList isActive />);
    await waitFor(() => expect(actionMocks.listEventLaunchSkipsAction).toHaveBeenCalled());
    await screen.findByText('Error: Workflow "Escalate": payload mismatch');
    expect(document.getElementById('workflow-event-detail-launch-skips')).not.toBeInTheDocument();
  });
});
