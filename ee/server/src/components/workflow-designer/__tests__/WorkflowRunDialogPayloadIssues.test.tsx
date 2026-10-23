/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startWorkflowRunAction = vi.fn();

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? '')),
  }),
}));
vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: () => null,
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES: new Set(['ticket', 'contact', 'user']),
}));
vi.mock('../workflowRunRecordResolvers', () => ({ WORKFLOW_RUN_RECORD_SOURCES: {} }));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({ getTicketById: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: vi.fn().mockResolvedValue({ tenant: 'tenant-1' }) }));
vi.mock('@alga-psa/workflows/actions', () => ({
  getWorkflowSchemaAction: vi.fn().mockResolvedValue({
    schema: {
      type: 'object',
      required: ['messageId', 'note'],
      properties: {
        messageId: { type: 'string', format: 'uuid', description: 'Message ID' },
        note: { type: 'string' },
      },
    },
  }),
  getLatestWorkflowRunAction: vi.fn().mockResolvedValue(null),
  listWorkflowSchemaRefsAction: vi.fn().mockResolvedValue({ refs: [] }),
  listWorkflowDefinitionVersionsAction: vi.fn().mockResolvedValue({ versions: [{ version: 1 }] }),
  startWorkflowRunAction: (...args: unknown[]) => startWorkflowRunAction(...args),
  getEventCatalogEntries: vi.fn().mockResolvedValue([]),
  getEventCatalogEntryByEventType: vi.fn().mockResolvedValue(null),
}));

import WorkflowRunDialog from '../WorkflowRunDialog';
import { clearWorkflowRunDraft } from '../workflowRunDraftStore';

afterEach(() => {
  cleanup();
  startWorkflowRunAction.mockReset();
  window.localStorage.clear();
  clearWorkflowRunDraft('workflow-1');
});

const renderDialog = async () => {
  await act(async () => {
    render(
      <WorkflowRunDialog
        isOpen
        onClose={vi.fn()}
        workflowId="workflow-1"
        payloadSchemaRef="payload.Test.v1"
        publishedVersion={1}
      />
    );
  });
  await waitFor(() => expect(document.getElementById('run-form-messageId')).toBeTruthy());
};

describe('Run dialog payload problems', () => {
  it('puts each server-reported problem next to its field, by name', async () => {
    startWorkflowRunAction.mockResolvedValue({
      runId: 'run-1',
      status: 'FAILED',
      payloadValidation: {
        appliesTo: 'input',
        issues: [{ path: ['messageId'], kind: 'format', format: 'uuid' }],
      },
    });
    await renderDialog();
    await act(async () => {
      fireEvent.change(document.getElementById('run-form-messageId')!, { target: { value: 'reply-1' } });
      fireEvent.change(document.getElementById('run-form-note')!, { target: { value: 'Hello' } });
    });
    await act(async () => {
      fireEvent.click(document.getElementById('run-dialog-start-run')!);
    });

    expect(startWorkflowRunAction).toHaveBeenCalledWith(expect.objectContaining({ reportPayloadIssues: true }));
    // Shown in the failure summary and next to the field; never a bare "payload failed validation".
    expect(screen.getByText('Fix these fields, then start the run again')).toBeTruthy();
    expect(screen.getAllByText(/^Message must be an id \(UUID\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/failed validation/i)).toBeNull();
  });

  it('clears the "Fix these fields" banner once a field changes', async () => {
    startWorkflowRunAction.mockResolvedValue({
      runId: 'run-1',
      status: 'FAILED',
      payloadValidation: {
        appliesTo: 'input',
        issues: [{ path: ['messageId'], kind: 'format', format: 'uuid' }],
      },
    });
    await renderDialog();
    await act(async () => {
      fireEvent.change(document.getElementById('run-form-messageId')!, { target: { value: 'reply-1' } });
      fireEvent.change(document.getElementById('run-form-note')!, { target: { value: 'Hello' } });
    });
    await act(async () => {
      fireEvent.click(document.getElementById('run-dialog-start-run')!);
    });
    expect(screen.getByText('Fix these fields, then start the run again')).toBeTruthy();

    await act(async () => {
      fireEvent.change(document.getElementById('run-form-note')!, { target: { value: 'Hello again' } });
    });
    expect(screen.queryByText('Fix these fields, then start the run again')).toBeNull();
  });

  it('offers a test id for a synthetic id field', async () => {
    await renderDialog();
    await act(async () => {
      fireEvent.click(document.getElementById('run-form-generate-id-messageId')!);
    });
    const value = (document.getElementById('run-form-messageId') as HTMLInputElement).value;
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
