// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createWorkflowDefinitionActionMock,
  getCurrentUserMock,
  getCurrentUserPermissionsMock,
  listWorkflowDefinitionsActionMock,
  publishWorkflowDefinitionActionMock,
  updateWorkflowDefinitionDraftActionMock,
  updateWorkflowDefinitionMetadataActionMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  createWorkflowDefinitionActionMock: vi.fn(),
  updateWorkflowDefinitionMetadataActionMock: vi.fn(),
  toastErrorMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getCurrentUserPermissionsMock: vi.fn(),
  listWorkflowDefinitionsActionMock: vi.fn(),
  publishWorkflowDefinitionActionMock: vi.fn(),
  updateWorkflowDefinitionDraftActionMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  // Keep the real formatters (the launch-skip banner uses useFormatters); only translations are stubbed.
  return { ...((await importOriginal()) as Record<string, unknown>), ...createLocaleTranslationMock('msp/workflows') };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Droppable: ({ children }: { children: (provided: any) => React.ReactNode }) => children({
    innerRef: vi.fn(),
    droppableProps: {},
    placeholder: null
  }),
  Draggable: ({ children }: { children: (provided: any, snapshot: any) => React.ReactNode }) => children({
    innerRef: vi.fn(),
    draggableProps: {},
    dragHandleProps: {}
  }, { isDragging: false })
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ id, isOpen, title, message, confirmLabel, onConfirm }: any) => (isOpen ? (
    <div id={id} role="dialog" aria-label={title}>
      <p>{message}</p>
      <button id={`${id}-confirm`} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null)
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, label, value, onChange, type = 'text', disabled }: any) => (
    <label htmlFor={id}>
      {label}
      <input id={id} data-testid={id} value={value ?? ''} onChange={onChange} type={type} disabled={disabled} />
    </label>
  )
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ id, value, onChange, disabled }: any) => (
    <textarea id={id} data-testid={id} value={value ?? ''} onChange={onChange} disabled={disabled} />
  )
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id }: any) => <div data-testid={id} />
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ children }: any) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, disabled }: any) => (
    <input
      id={id}
      type="checkbox"
      data-testid={id}
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  )
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children }: any) => <label>{children}</label>
}));

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ id }: any) => <div data-testid={id} />
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />
}));

vi.mock('@alga-psa/analytics/client', () => ({
  analytics: { capture: vi.fn() }
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getCurrentUserPermissions: (...args: unknown[]) => getCurrentUserPermissionsMock(...args),
  getAllUsersBasic: vi.fn(async () => []),
  getUserAvatarUrlsBatchAction: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn(async () => []),
  getTeamAvatarUrlsBatchAction: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: vi.fn(async () => []),
  getContactsByClient: vi.fn(async () => []),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getAvailableStatuses: vi.fn(async () => []),
  getTicketFieldOptions: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getTicketById: vi.fn(async () => null),
  getTicketsForList: vi.fn(async () => []),
}));

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  getProjectsWithPhases: vi.fn(async () => []),
}));

vi.mock('@alga-psa/projects/actions/projectTaskActions', () => ({
  getProjectTaskData: vi.fn(async () => []),
}));

vi.mock('../expression-editor', () => ({
  ExpressionEditor: React.forwardRef(({ value, onChange, ariaLabel }: any) => (
    <textarea
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ))
}));

vi.mock('@alga-psa/workflows/actions', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@alga-psa/workflows/actions');
  return {
    ...actual,
    getWorkflowSchemaAction: vi.fn(async () => ({ ref: 'payload.Test.v1', schema: { type: 'object', properties: {} } })),
    getEventCatalogEntryByEventType: vi.fn(async () => null),
    listWorkflowDefinitionsAction: (...args: unknown[]) => listWorkflowDefinitionsActionMock(...args),
    listWorkflowRegistryActionsAction: vi.fn(async () => []),
    listWorkflowRegistryNodesAction: vi.fn(async () => []),
    listWorkflowDesignerActionCatalogAction: vi.fn(async () => []),
    listWorkflowSchemaRefsAction: vi.fn(async () => ({ refs: [] })),
    listWorkflowSchemasMetaAction: vi.fn(async () => ({ schemas: [] })),
    listWorkflowRunsAction: vi.fn(async () => ({ runs: [] })),
    listEventCatalogOptionsV2Action: vi.fn(async () => ({ events: [] })),
    getWorkflowStepQuotaSummaryAction: vi.fn(async () => null),
    createWorkflowDefinitionAction: (...args: unknown[]) => createWorkflowDefinitionActionMock(...args),
    getWorkflowDefinitionVersionAction: vi.fn(),
    publishWorkflowDefinitionAction: (...args: unknown[]) => publishWorkflowDefinitionActionMock(...args),
    updateWorkflowDefinitionDraftAction: (...args: unknown[]) => updateWorkflowDefinitionDraftActionMock(...args),
    updateWorkflowDefinitionMetadataAction: (...args: unknown[]) => updateWorkflowDefinitionMetadataActionMock(...args),
  };
});

vi.mock('../WorkflowRunList', () => ({ default: () => <div /> }));
vi.mock('../WorkflowDeadLetterQueue', () => ({ default: () => <div /> }));
vi.mock('../WorkflowEventList', () => ({ default: () => <div /> }));
vi.mock('../WorkflowRunDialog', () => ({ default: () => <div /> }));
vi.mock('../WorkflowDesignerAuditPanel', () => ({ WorkflowDesignerAuditPanel: () => <div /> }));
vi.mock('../../workflow-graph/WorkflowGraph', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/workflows/components/automation-hub/WorkflowList', () => ({ default: () => <div /> }));
vi.mock('@alga-psa/workflows/components/automation-hub/EventsCatalogV2', () => ({ default: () => <div /> }));
vi.mock('../WorkflowSchedules', () => ({ default: () => <div /> }));
vi.mock('../mapping', () => ({ MappingPanel: () => <div /> }));
vi.mock('../ActionSchemaReference', () => ({ ActionSchemaReference: () => <div /> }));
vi.mock('../WorkflowAiSchemaSection', () => ({ WorkflowAiSchemaSection: () => <div /> }));
vi.mock('../WorkflowComposeTextSection', () => ({ WorkflowComposeTextSection: () => <div /> }));
vi.mock('../GroupedActionConfigSection', () => ({ GroupedActionConfigSection: () => <div /> }));
vi.mock('../WorkflowDesignerPalette', () => ({ WorkflowDesignerPalette: () => <div /> }));
vi.mock('../PaletteItemWithTooltip', () => ({ PaletteItemWithTooltip: () => <div /> }));
vi.mock('../WorkflowStepNameField', () => ({ WorkflowStepNameField: () => <div /> }));
vi.mock('../WorkflowStepSaveOutputSection', () => ({ WorkflowStepSaveOutputSection: () => <div /> }));
vi.mock('../WorkflowActionInputSection', () => ({ WorkflowActionInputSection: () => <div /> }));
vi.mock('../WorkflowActionInputFixedPicker', () => ({ WorkflowActionInputFixedPicker: () => <div /> }));

import WorkflowDesigner from '../WorkflowDesigner';

const record = (workflowId: string, name: string) => ({
  workflow_id: workflowId,
  name,
  description: '',
  draft_definition: {
    id: workflowId,
    version: 1,
    name,
    payloadSchemaRef: 'payload.Test.v1',
    steps: [],
  },
  draft_version: 1,
  published_version: null,
  payload_schema_ref: 'payload.Test.v1',
  payload_schema_mode: 'pinned',
  pinned_payload_schema_ref: 'payload.Test.v1',
  validation_status: 'valid',
  validation_errors: [],
  validation_warnings: [],
  validated_at: '2026-09-11T00:00:00.000Z',
  is_system: false,
  is_visible: true,
  is_paused: false,
});

const nameInput = () => screen.getByTestId('workflow-designer-name') as HTMLInputElement;
const setAddress = (path: string) => window.history.replaceState(null, '', path);

describe('WorkflowDesigner route loading', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    getCurrentUserPermissionsMock.mockReset();
    listWorkflowDefinitionsActionMock.mockReset();
    createWorkflowDefinitionActionMock.mockReset();
    publishWorkflowDefinitionActionMock.mockReset();
    updateWorkflowDefinitionDraftActionMock.mockReset();
    updateWorkflowDefinitionMetadataActionMock.mockReset();
    toastErrorMock.mockReset();

    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', roles: [] });
    getCurrentUserPermissionsMock.mockResolvedValue(['workflow:read', 'workflow:manage', 'workflow:publish']);
    listWorkflowDefinitionsActionMock.mockResolvedValue([record('wf-a', 'Workflow A'), record('wf-b', 'Workflow B')]);
    window.localStorage.clear();
    setAddress('/msp/workflow-editor/new');
  });

  it('loads the saved workflow when browser Back restores the /new route under its address', async () => {
    // After a first save the address names the workflow but Next keeps the /new route for that
    // history entry, so Back from Run Studio mounts the designer with isNew.
    setAddress('/msp/workflow-editor/wf-a');
    render(<WorkflowDesigner mode="editor-designer" isNew />);

    await waitFor(() => expect(nameInput().value).toBe('Workflow A'));
    expect(await screen.findByTestId('workflow-settings-paused')).toBeInTheDocument();
  });

  it('loads the workflow whenever the route id changes', async () => {
    setAddress('/msp/workflow-editor/wf-a');
    const { rerender } = render(<WorkflowDesigner mode="editor-designer" workflowId="wf-a" />);
    await waitFor(() => expect(nameInput().value).toBe('Workflow A'));

    setAddress('/msp/workflow-editor/wf-b');
    rerender(<WorkflowDesigner mode="editor-designer" workflowId="wf-b" />);
    await waitFor(() => expect(nameInput().value).toBe('Workflow B'));
  });

  it('loads the workflow the address names after a back/forward (popstate) on the /new route', async () => {
    render(<WorkflowDesigner mode="editor-designer" isNew />);
    await waitFor(() => expect(nameInput().value).toBe('New Workflow'));

    setAddress('/msp/workflow-editor/wf-b');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    await waitFor(() => expect(nameInput().value).toBe('Workflow B'));
  });

  it('keeps the edits on screen and moves the address to the new id on a first save', async () => {
    createWorkflowDefinitionActionMock.mockResolvedValue({ workflowId: 'wf-new' });
    render(<WorkflowDesigner mode="editor-designer" isNew />);
    await waitFor(() => expect(nameInput().value).toBe('New Workflow'));

    fireEvent.change(nameInput(), { target: { value: 'Typed name' } });
    expect(document.getElementById('workflow-designer-save-status')?.textContent).toMatch(/Not saved yet/);
    listWorkflowDefinitionsActionMock.mockResolvedValue([
      record('wf-a', 'Workflow A'),
      record('wf-new', 'Server copy'),
    ]);
    fireEvent.click(document.getElementById('workflow-designer-save')!);

    await waitFor(() => expect(window.location.pathname).toBe('/msp/workflow-editor/wf-new'));
    await waitFor(() => expect(listWorkflowDefinitionsActionMock).toHaveBeenCalledTimes(2));
    // The route effect must not reload the just-created workflow over the editing state.
    expect(nameInput().value).toBe('Typed name');
    // A lasting "Saved" note, not just the toast.
    expect(document.getElementById('workflow-designer-save-status')?.textContent).toMatch(/^Saved/);
  });

  it('explains why Run is disabled while the workflow is paused', async () => {
    listWorkflowDefinitionsActionMock.mockResolvedValue([
      { ...record('wf-a', 'Workflow A'), published_version: 1, is_paused: true },
    ]);
    setAddress('/msp/workflow-editor/wf-a');
    render(<WorkflowDesigner mode="editor-designer" workflowId="wf-a" />);
    await waitFor(() => expect(nameInput().value).toBe('Workflow A'));

    const runButton = await waitFor(() => {
      const button = document.getElementById('workflow-designer-run');
      expect(button).not.toBeNull();
      return button!;
    });
    expect(runButton).toBeDisabled();
    expect(runButton).toHaveAttribute('title', 'Paused: resume the workflow to run it.');
  });
});
