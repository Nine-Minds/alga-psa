/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  listWorkflowDefinitionsPagedAction: vi.fn(),
  deleteWorkflowDefinitionAction: vi.fn(),
  preCheckWorkflowDefinitionDeletion: vi.fn(),
  updateWorkflowDefinitionMetadataAction: vi.fn(),
  listWorkflowLaunchSkipCountsAction: vi.fn(),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/workflow-editor',
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; [name: string]: unknown }) =>
      (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? '')),
  }),
}));

vi.mock('@alga-psa/ui', () => ({ DeleteEntityDialog: () => null }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));

// Render the dropdown inline so menu items can be asserted without driving Radix pointer events.
vi.mock('@radix-ui/react-dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Root: Pass,
    Trigger: Pass,
    Portal: Pass,
    Content: ({ children }: { children?: React.ReactNode }) => <div role="menu">{children}</div>,
    Separator: () => <hr />,
    Item: ({ children, onSelect, disabled, id }: { children?: React.ReactNode; onSelect?: (event: Event) => void; disabled?: boolean; id?: string }) => (
      <button
        type="button"
        role="menuitem"
        id={id}
        disabled={disabled}
        onClick={() => onSelect?.(new Event('select'))}
      >
        {children}
      </button>
    ),
  };
});

vi.mock('@alga-psa/workflows/actions', () => actionMocks);

import WorkflowList from './WorkflowList';

const baseRow = {
  description: null,
  status: 'published',
  is_system: false,
  is_visible: true,
  is_paused: false,
  trigger: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const rows = [
  { ...baseRow, workflow_id: 'wf-fresh', name: 'Just published', draft_version: 2, published_version: 1, has_unpublished_changes: false },
  { ...baseRow, workflow_id: 'wf-edited', name: 'Edited after publish', draft_version: 2, published_version: 1, has_unpublished_changes: true },
  { ...baseRow, workflow_id: 'wf-draft', name: 'Never published', status: 'draft', draft_version: 1, published_version: null, has_unpublished_changes: null },
  { ...baseRow, workflow_id: 'wf-paused', name: 'Paused one', draft_version: 2, published_version: 1, has_unpublished_changes: false, is_paused: true },
];

describe('WorkflowList row actions and draft badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.listWorkflowDefinitionsPagedAction.mockResolvedValue({
      items: rows,
      totalItems: rows.length,
      counts: { total: rows.length, active: 3, draft: 1, paused: 1 },
    });
    actionMocks.updateWorkflowDefinitionMetadataAction.mockResolvedValue({ ok: true });
    actionMocks.listWorkflowLaunchSkipCountsAction.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  it('renders a row menu (not a second selection checkbox) in the Actions column', async () => {
    render(<WorkflowList onRunWorkflow={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Edited after publish')).toBeInTheDocument());

    for (const row of rows) {
      expect(document.getElementById(`workflow-list-row-menu-${row.workflow_id}`)).toBeInTheDocument();
      expect(document.getElementById(`workflow-list-row-open-${row.workflow_id}`)).toBeInTheDocument();
    }
  });

  it('shows "Unpublished changes" only when the draft differs from the published version', async () => {
    render(<WorkflowList />);
    await waitFor(() => expect(screen.getByText('Edited after publish')).toBeInTheDocument());

    expect(document.getElementById('workflow-list-unpublished-changes-wf-edited')).toBeInTheDocument();
    expect(document.getElementById('workflow-list-unpublished-changes-wf-fresh')).not.toBeInTheDocument();
    expect(document.getElementById('workflow-list-unpublished-changes-wf-draft')).not.toBeInTheDocument();
    expect(screen.queryByText(/Draft: v/)).not.toBeInTheDocument();
  });

  it('offers Run for published workflows when the host can start runs, disabled while paused', async () => {
    const onRunWorkflow = vi.fn();
    render(<WorkflowList onRunWorkflow={onRunWorkflow} />);
    await waitFor(() => expect(screen.getByText('Just published')).toBeInTheDocument());

    expect(document.getElementById('workflow-list-row-run-wf-draft')).not.toBeInTheDocument();
    expect(document.getElementById('workflow-list-row-run-wf-paused')).toBeDisabled();

    fireEvent.click(document.getElementById('workflow-list-row-run-wf-fresh') as HTMLElement);
    expect(onRunWorkflow).toHaveBeenCalledWith('wf-fresh');
  });

  it('shows an "N skipped" warning badge only for workflows with alarming skips (alga0002106)', async () => {
    actionMocks.listWorkflowLaunchSkipCountsAction.mockResolvedValue({ 'wf-fresh': 3 });
    render(<WorkflowList />);
    await waitFor(() => expect(screen.getByText('3 skipped')).toBeInTheDocument());

    expect(screen.getAllByText(/skipped$/)).toHaveLength(1);
    expect(actionMocks.listWorkflowLaunchSkipCountsAction).toHaveBeenCalledTimes(1);
    expect(actionMocks.listWorkflowLaunchSkipCountsAction).toHaveBeenCalledWith(
      expect.objectContaining({ workflowIds: rows.map((row) => row.workflow_id) })
    );
  });

  it('still renders the list when the skip-count query fails (alga0002106)', async () => {
    actionMocks.listWorkflowLaunchSkipCountsAction.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<WorkflowList />);
    await waitFor(() => expect(screen.getByText('Just published')).toBeInTheDocument());
    expect(screen.queryByText(/skipped$/)).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('hides Run when the host provides no way to start runs', async () => {
    render(<WorkflowList />);
    await waitFor(() => expect(screen.getByText('Just published')).toBeInTheDocument());
    expect(document.getElementById('workflow-list-row-run-wf-fresh')).not.toBeInTheDocument();
  });

  it('pauses and resumes from the row menu', async () => {
    render(<WorkflowList />);
    await waitFor(() => expect(screen.getByText('Just published')).toBeInTheDocument());

    fireEvent.click(document.getElementById('workflow-list-row-toggle-pause-wf-fresh') as HTMLElement);
    fireEvent.click(document.getElementById('workflow-list-row-toggle-pause-wf-paused') as HTMLElement);

    await waitFor(() => expect(actionMocks.updateWorkflowDefinitionMetadataAction).toHaveBeenCalledTimes(2));
    expect(actionMocks.updateWorkflowDefinitionMetadataAction).toHaveBeenCalledWith({ workflowId: 'wf-fresh', isPaused: true });
    expect(actionMocks.updateWorkflowDefinitionMetadataAction).toHaveBeenCalledWith({ workflowId: 'wf-paused', isPaused: false });
  });

  it('opens the editor from the row menu', async () => {
    const onSelectWorkflow = vi.fn();
    render(<WorkflowList onSelectWorkflow={onSelectWorkflow} />);
    await waitFor(() => expect(screen.getByText('Just published')).toBeInTheDocument());

    fireEvent.click(document.getElementById('workflow-list-row-open-wf-edited') as HTMLElement);
    expect(onSelectWorkflow).toHaveBeenCalledWith('wf-edited');
  });
});
