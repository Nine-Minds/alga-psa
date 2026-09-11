// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentUserMock,
  getCurrentUserPermissionsMock,
  listWorkflowDefinitionsActionMock,
  publishWorkflowDefinitionActionMock,
  updateWorkflowDefinitionDraftActionMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getCurrentUserPermissionsMock: vi.fn(),
  listWorkflowDefinitionsActionMock: vi.fn(),
  publishWorkflowDefinitionActionMock: vi.fn(),
  updateWorkflowDefinitionDraftActionMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('@ee/__tests__/utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/workflows');
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
  ConfirmationDialog: () => <div />
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
    createWorkflowDefinitionAction: vi.fn(),
    getWorkflowDefinitionVersionAction: vi.fn(),
    publishWorkflowDefinitionAction: (...args: unknown[]) => publishWorkflowDefinitionActionMock(...args),
    updateWorkflowDefinitionDraftAction: (...args: unknown[]) => updateWorkflowDefinitionDraftActionMock(...args),
    updateWorkflowDefinitionMetadataAction: vi.fn(async () => ({})),
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

const WORKFLOW_ID = 'wf-publish-error-reset';
const EMPTY_EXPR_MESSAGE = 'Expression is empty. Pick a source field or enter an expression.';

const draftDefinition = () => ({
  id: WORKFLOW_ID,
  version: 2,
  name: 'Publish error reset',
  payloadSchemaRef: 'payload.Test.v1',
  steps: [
    {
      id: 'if-1',
      type: 'control.if',
      condition: { $expr: 'true' },
      then: [{ id: 'return-1', type: 'control.return' }],
    },
  ],
});

const cleanRecord = () => ({
  workflow_id: WORKFLOW_ID,
  name: 'Publish error reset',
  description: '',
  draft_definition: draftDefinition(),
  draft_version: 2,
  published_version: 1,
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

const publishButton = () => screen.getByRole('button', { name: 'Publish' });

describe('WorkflowDesigner publish error reset', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    getCurrentUserPermissionsMock.mockReset();
    listWorkflowDefinitionsActionMock.mockReset();
    publishWorkflowDefinitionActionMock.mockReset();
    updateWorkflowDefinitionDraftActionMock.mockReset();

    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', roles: [] });
    getCurrentUserPermissionsMock.mockResolvedValue(['workflow:read', 'workflow:manage', 'workflow:publish']);
    listWorkflowDefinitionsActionMock.mockResolvedValue([cleanRecord()]);
    updateWorkflowDefinitionDraftActionMock.mockResolvedValue({});
  });

  it('clears a blocked publish result once the draft is saved again', async () => {
    publishWorkflowDefinitionActionMock.mockResolvedValue({
      ok: false,
      errors: [
        {
          severity: 'error',
          stepPath: 'root.steps[0].condition',
          stepId: 'if-1',
          code: 'INVALID_EXPR',
          message: EMPTY_EXPR_MESSAGE,
        },
      ],
      warnings: [],
    });

    render(<WorkflowDesigner mode="editor-designer" workflowId={WORKFLOW_ID} />);

    await waitFor(() => expect(publishButton()).toBeEnabled());

    fireEvent.click(publishButton());

    await waitFor(() => expect(publishButton()).toBeDisabled());
    expect(publishButton()).toHaveAttribute('title', EMPTY_EXPR_MESSAGE);

    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => expect(updateWorkflowDefinitionDraftActionMock).toHaveBeenCalled());
    // Without clearing the stale publish result the badge stays Invalid and Publish
    // stays disabled until the page is reloaded.
    await waitFor(() => expect(publishButton()).toBeEnabled());
    expect(publishButton()).not.toHaveAttribute('title');
  });
});
