/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startWorkflowRunAction = vi.fn();

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  // Date pickers read the optional i18n context for the date format; none here.
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? '')),
  }),
}));
// The contract picker: one button that picks contract c1.
vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: ({ idPrefix, onChange }: { idPrefix: string; onChange: (value: string) => void }) => (
    <button id={`${idPrefix}-pick`} type="button" onClick={() => onChange('c1')}>pick</button>
  ),
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES: new Set(['contract', 'client']),
}));
vi.mock('../workflowRunRecordResolvers', () => ({
  WORKFLOW_RUN_RECORD_SOURCES: {
    contract: {
      fields: ['client_id', 'client_name', 'end_date'],
      kindFields: { client: ['client_id'] },
      resolve: vi.fn(async () => ({ end_date: '2026-12-08', client_id: 'client-1', client_name: 'Acme' })),
    },
  },
}));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({ getTicketById: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn().mockResolvedValue({ tenant: 'tenant-1' }) }));
vi.mock('@alga-psa/workflows/actions', () => {
  const date = { type: 'string', format: 'date', description: 'Calendar date (YYYY-MM-DD)' };
  return {
  getWorkflowSchemaAction: vi.fn().mockResolvedValue({
    schema: {
      type: 'object',
      required: ['occursOn', 'fireDate', 'offsetDays', 'contractId', 'clientId', 'endDate'],
      properties: {
        contractId: { type: 'string', 'x-workflow-picker-kind': 'contract' },
        clientId: { type: 'string' },
        clientName: { type: 'string' },
        occursOn: date,
        fireDate: date,
        offsetDays: { type: 'integer' },
        endDate: date,
      },
    },
  }),
  getLatestWorkflowRunAction: vi.fn().mockResolvedValue(null),
  listWorkflowSchemaRefsAction: vi.fn().mockResolvedValue({ refs: [] }),
  listWorkflowDefinitionVersionsAction: vi.fn().mockResolvedValue({ versions: [{ version: 1 }] }),
  startWorkflowRunAction: (...args: unknown[]) => startWorkflowRunAction(...args),
  getEventCatalogEntries: vi.fn().mockResolvedValue([]),
  getEventCatalogEntryByEventType: vi.fn().mockResolvedValue(null),
  };
});

import WorkflowRunDialog from '../WorkflowRunDialog';
import { clearWorkflowRunDraft } from '../workflowRunDraftStore';

afterEach(() => {
  cleanup();
  startWorkflowRunAction.mockReset();
  window.localStorage.clear();
  clearWorkflowRunDraft('workflow-date');
});

const dialog = (isOpen: boolean) => (
  <WorkflowRunDialog
    isOpen={isOpen}
    onClose={vi.fn()}
    workflowId="workflow-date"
    payloadSchemaRef="payload.ContractEndDate.v1"
    publishedVersion={1}
    triggerLabel="Contract end date, 30 days before"
    dateTrigger={{ source: 'contract.end', offsetDays: -30 }}
  />
);

const openDialog = async () => {
  const view = render(dialog(true));
  await waitFor(() => expect(document.getElementById('run-form-offsetDays')).toBeTruthy());
  return view;
};

describe('Run dialog for a date-triggered workflow', () => {
  it('derives the trigger dates from the trigger and the picked contract, and explains them', async () => {
    startWorkflowRunAction.mockResolvedValue({ runId: 'run-1', status: 'RUNNING' });
    await openDialog();

    // The offset comes from the trigger (30 days before = -30), with a plain explanation.
    expect((document.getElementById('run-form-offsetDays') as HTMLInputElement).value).toBe('-30');
    expect(document.getElementById('run-form-offsetDays-help')?.textContent).toMatch(/30 days before/);
    expect(document.getElementById('run-form-fireDate-help')?.textContent).toMatch(/the date above plus the offset/);
    // A form nobody has used yet shows no errors.
    expect(screen.queryByText(/is required/)).toBeNull();

    // Labels: how this run starts vs. what starts the workflow.
    expect((document.getElementById('run-dialog-run-source') as HTMLInputElement).value).toBe('Manual test');
    expect((document.getElementById('run-dialog-trigger') as HTMLInputElement).value).toBe('Contract end date, 30 days before');

    await act(async () => {
      fireEvent.click(document.getElementById('run-form-contractId-pick')!);
    });
    await act(async () => {
      fireEvent.click(document.getElementById('run-dialog-start-run')!);
    });

    expect(startWorkflowRunAction).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        contractId: 'c1',
        clientId: 'client-1',
        endDate: '2026-12-08',
        occursOn: '2026-12-08',
        offsetDays: -30,
        fireDate: '2026-11-08',
      }),
    }));
  });

  it('shows problems only after a start attempt', async () => {
    startWorkflowRunAction.mockResolvedValue({ runId: 'run-1', status: 'RUNNING' });
    await openDialog();
    expect(screen.queryByText(/is required/)).toBeNull();
    await act(async () => {
      fireEvent.click(document.getElementById('run-dialog-start-run')!);
    });
    expect(screen.getAllByText(/is required/).length).toBeGreaterThan(0);
  });

  it('keeps the draft payload across close and reopen until Start over', async () => {
    const view = await openDialog();
    await act(async () => {
      fireEvent.change(document.getElementById('run-form-clientName')!, { target: { value: 'Typed client' } });
    });
    // Close (as Escape would) and reopen.
    await act(async () => {
      view.rerender(dialog(false));
    });
    await act(async () => {
      view.rerender(dialog(true));
    });
    await waitFor(() => expect((document.getElementById('run-form-clientName') as HTMLInputElement).value).toBe('Typed client'));
    expect(screen.getByText(/Your last test payload for this workflow is back/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(document.getElementById('run-dialog-start-over')!);
    });
    await waitFor(() => expect((document.getElementById('run-form-clientName') as HTMLInputElement).value).toBe(''));
    expect((document.getElementById('run-form-offsetDays') as HTMLInputElement).value).toBe('-30');
  });
});
