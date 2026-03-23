// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentUserMock,
  getCurrentUserPermissionsMock,
  listWorkflowDefinitionsActionMock,
  listWorkflowRegistryNodesActionMock,
  listWorkflowRegistryActionsActionMock,
  listWorkflowDesignerActionCatalogActionMock,
  listWorkflowSchemaRefsActionMock,
  listWorkflowSchemasMetaActionMock,
  listEventCatalogOptionsV2ActionMock,
  getEventCatalogEntryByEventTypeMock,
  routerReplaceMock
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getCurrentUserPermissionsMock: vi.fn(),
  listWorkflowDefinitionsActionMock: vi.fn(),
  listWorkflowRegistryNodesActionMock: vi.fn(),
  listWorkflowRegistryActionsActionMock: vi.fn(),
  listWorkflowDesignerActionCatalogActionMock: vi.fn(),
  listWorkflowSchemaRefsActionMock: vi.fn(),
  listWorkflowSchemasMetaActionMock: vi.fn(),
  listEventCatalogOptionsV2ActionMock: vi.fn(),
  getEventCatalogEntryByEventTypeMock: vi.fn(),
  routerReplaceMock: vi.fn()
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: (...args: unknown[]) => routerReplaceMock(...args),
  }),
  useSearchParams: () => ({
    get: () => null,
    toString: () => ''
  })
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
  Droppable: ({ children }: { children: (provided: any) => React.ReactNode }) => children({
    innerRef: vi.fn(),
    droppableProps: {}
  }),
  Draggable: ({ children }: { children: (provided: any) => React.ReactNode }) => children({
    innerRef: vi.fn(),
    draggableProps: {},
    dragHandleProps: {}
  })
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => <div data-testid="confirmation-dialog-smoke" />
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => <div data-testid="custom-select-smoke" />
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ children }: any) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: (props: any) => <input type="checkbox" {...props} />
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children }: any) => <label>{children}</label>
}));

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: () => <div data-testid="searchable-select-smoke" />
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton-smoke" />
}));

vi.mock('@alga-psa/analytics/client', () => ({
  analytics: {
    capture: vi.fn()
  }
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getCurrentUserPermissions: (...args: unknown[]) => getCurrentUserPermissionsMock(...args)
}));

vi.mock('@alga-psa/workflows/actions', () => ({
  getEventCatalogEntryByEventType: (...args: unknown[]) => getEventCatalogEntryByEventTypeMock(...args),
  listEventCatalogOptionsV2Action: (...args: unknown[]) => listEventCatalogOptionsV2ActionMock(...args),
  createWorkflowDefinitionAction: vi.fn(),
  getWorkflowSchemaAction: vi.fn(async () => ({ ref: 'payload.Empty.v1', schema: { type: 'object', properties: {} } })),
  getWorkflowDefinitionVersionAction: vi.fn(),
  listWorkflowDesignerActionCatalogAction: (...args: unknown[]) => listWorkflowDesignerActionCatalogActionMock(...args),
  listWorkflowSchemaRefsAction: (...args: unknown[]) => listWorkflowSchemaRefsActionMock(...args),
  listWorkflowSchemasMetaAction: (...args: unknown[]) => listWorkflowSchemasMetaActionMock(...args),
  listWorkflowDefinitionsAction: (...args: unknown[]) => listWorkflowDefinitionsActionMock(...args),
  listWorkflowRegistryActionsAction: (...args: unknown[]) => listWorkflowRegistryActionsActionMock(...args),
  listWorkflowRegistryNodesAction: (...args: unknown[]) => listWorkflowRegistryNodesActionMock(...args),
  listWorkflowRunsAction: vi.fn(async () => []),
  publishWorkflowDefinitionAction: vi.fn(),
  updateWorkflowDefinitionDraftAction: vi.fn(),
  updateWorkflowDefinitionMetadataAction: vi.fn()
}));

vi.mock('@alga-psa/workflows/runtime', () => ({
  buildWorkflowDesignerActionCatalog: vi.fn(() => []),
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF: 'payload.WorkflowClock.v1',
  isWorkflowAiInferAction: vi.fn(() => false),
  resolveWorkflowAiSchemaFromConfig: vi.fn(() => ({ schema: null, errors: [] })),
  validateExpressionSource: vi.fn(() => []),
}));

vi.mock('../WorkflowRunList', () => ({
  default: () => <div data-testid="workflow-run-list-smoke" />
}));

vi.mock('../WorkflowDeadLetterQueue', () => ({
  default: () => <div data-testid="workflow-dead-letter-smoke" />
}));

vi.mock('../WorkflowEventList', () => ({
  default: () => <div data-testid="workflow-event-list-smoke" />
}));

vi.mock('../WorkflowRunDialog', () => ({
  default: () => <div data-testid="workflow-run-dialog-smoke" />
}));

vi.mock('../../workflow-graph/WorkflowGraph', () => ({
  default: () => <div data-testid="workflow-graph-smoke" />
}));

vi.mock('../mapping', () => ({
  MappingPanel: () => <div data-testid="mapping-panel-smoke" />
}));

vi.mock('../expression-editor', () => ({
  ExpressionEditor: () => <div data-testid="expression-editor-smoke" />
}));

vi.mock('@alga-psa/workflows/components/automation-hub/WorkflowList', () => ({
  default: () => <div data-testid="workflow-list-smoke" />
}));

vi.mock('@alga-psa/workflows/components/automation-hub/EventsCatalogV2', () => ({
  default: () => <div data-testid="workflow-events-catalog-smoke" />
}));

vi.mock('../WorkflowSchedules', () => ({
  default: () => <div data-testid="workflow-schedules-smoke" />
}));

vi.mock('../ActionSchemaReference', () => ({
  ActionSchemaReference: () => <div data-testid="action-schema-reference-smoke" />
}));

vi.mock('../WorkflowAiSchemaSection', () => ({
  WorkflowAiSchemaSection: () => <div data-testid="workflow-ai-schema-smoke" />
}));

vi.mock('../WorkflowComposeTextSection', () => ({
  WorkflowComposeTextSection: () => <div data-testid="workflow-compose-text-smoke" />
}));

vi.mock('../GroupedActionConfigSection', () => ({
  GroupedActionConfigSection: () => <div data-testid="grouped-action-config-smoke" />
}));

vi.mock('../WorkflowDesignerPalette', () => ({
  WorkflowDesignerPalette: () => <div data-testid="workflow-designer-palette-smoke" />
}));

vi.mock('../PaletteItemWithTooltip', () => ({
  PaletteItemWithTooltip: () => <div data-testid="palette-item-tooltip-smoke" />
}));

vi.mock('../WorkflowStepNameField', () => ({
  WorkflowStepNameField: () => <div data-testid="workflow-step-name-smoke" />
}));

vi.mock('../WorkflowStepSaveOutputSection', () => ({
  WorkflowStepSaveOutputSection: () => <div data-testid="workflow-step-save-output-smoke" />
}));

vi.mock('../WorkflowActionInputSection', () => ({
  WorkflowActionInputSection: () => <div data-testid="workflow-action-input-smoke" />
}));

import WorkflowDesigner from '../WorkflowDesigner';

describe('WorkflowDesigner smoke', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    getCurrentUserPermissionsMock.mockReset();
    listWorkflowDefinitionsActionMock.mockReset();
    listWorkflowRegistryNodesActionMock.mockReset();
    listWorkflowRegistryActionsActionMock.mockReset();
    listWorkflowDesignerActionCatalogActionMock.mockReset();
    listWorkflowSchemaRefsActionMock.mockReset();
    listWorkflowSchemasMetaActionMock.mockReset();
    listEventCatalogOptionsV2ActionMock.mockReset();
    getEventCatalogEntryByEventTypeMock.mockReset();
    routerReplaceMock.mockReset();

    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', roles: [] });
    getCurrentUserPermissionsMock.mockResolvedValue(['workflow:read']);
    listWorkflowDefinitionsActionMock.mockResolvedValue([]);
    listWorkflowRegistryNodesActionMock.mockResolvedValue([]);
    listWorkflowRegistryActionsActionMock.mockResolvedValue([]);
    listWorkflowDesignerActionCatalogActionMock.mockResolvedValue([]);
    listWorkflowSchemaRefsActionMock.mockResolvedValue([]);
    listWorkflowSchemasMetaActionMock.mockResolvedValue([]);
    listEventCatalogOptionsV2ActionMock.mockResolvedValue({ events: [] });
    getEventCatalogEntryByEventTypeMock.mockResolvedValue(null);
  });

  it('T050: renders the top-level workflow designer shell through the EE workflows package actions', async () => {
    render(<WorkflowDesigner />);

    await waitFor(() => {
      expect(screen.getByTestId('workflow-list-smoke')).toBeInTheDocument();
    });

    expect(listWorkflowDefinitionsActionMock).toHaveBeenCalled();
    expect(listWorkflowRegistryNodesActionMock).toHaveBeenCalled();
    expect(listWorkflowRegistryActionsActionMock).toHaveBeenCalled();
    expect(listWorkflowDesignerActionCatalogActionMock).toHaveBeenCalled();
  });
});
