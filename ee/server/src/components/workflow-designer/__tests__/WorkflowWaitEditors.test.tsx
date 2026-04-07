// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getWorkflowSchemaActionMock,
  getEventCatalogEntryByEventTypeMock,
} = vi.hoisted(() => ({
  getWorkflowSchemaActionMock: vi.fn(),
  getEventCatalogEntryByEventTypeMock: vi.fn(),
}));

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
  default: ({ id, value, options = [], onValueChange, label, disabled }: any) => (
    <label htmlFor={id}>
      {label}
      <select
        id={id}
        data-testid={id}
        value={value ?? ''}
        onChange={(event) => onValueChange?.(event.target.value)}
        disabled={disabled}
      >
        <option value="" />
        {options.map((option: any) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
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
  default: ({ id, value, options = [], onChange, label, disabled }: any) => (
    <label htmlFor={id}>
      {label}
      <select
        id={id}
        data-testid={id}
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
      >
        <option value="" />
        {options.map((option: any) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />
}));

vi.mock('@alga-psa/analytics/client', () => ({
  analytics: { capture: vi.fn() }
}));

vi.mock('../expression-editor', () => ({
  ExpressionEditor: React.forwardRef(({ value, onChange, ariaLabel }: any, ref) => (
    <textarea
      aria-label={ariaLabel}
      data-testid={ariaLabel}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ))
}));

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: ({ idPrefix }: { idPrefix: string }) => (
    <div data-testid={`${idPrefix}-typed-picker`} />
  )
}));

vi.mock('@alga-psa/workflows/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/workflows/actions')>();
  return {
    ...actual,
    getWorkflowSchemaAction: (...args: unknown[]) => getWorkflowSchemaActionMock(...args),
    getEventCatalogEntryByEventType: (...args: unknown[]) => getEventCatalogEntryByEventTypeMock(...args),
    listWorkflowDefinitionsAction: vi.fn(async () => []),
    listWorkflowRegistryActionsAction: vi.fn(async () => []),
    listWorkflowRegistryNodesAction: vi.fn(async () => []),
    listWorkflowDesignerActionCatalogAction: vi.fn(async () => []),
    listWorkflowSchemaRefsAction: vi.fn(async () => ({ refs: [] })),
    listWorkflowSchemasMetaAction: vi.fn(async () => ({ schemas: [] })),
    listWorkflowRunsAction: vi.fn(async () => ({ runs: [] })),
    listEventCatalogOptionsV2Action: vi.fn(async () => ({ events: [] })),
    createWorkflowDefinitionAction: vi.fn(),
    getWorkflowDefinitionVersionAction: vi.fn(),
    publishWorkflowDefinitionAction: vi.fn(),
    updateWorkflowDefinitionDraftAction: vi.fn(),
    updateWorkflowDefinitionMetadataAction: vi.fn(),
  };
});

vi.mock('@alga-psa/workflows/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/workflows/runtime')>();
  return {
    ...actual,
    buildWorkflowDesignerActionCatalog: vi.fn(() => []),
    WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF: 'payload.WorkflowClock.v1',
    isWorkflowAiInferAction: vi.fn(() => false),
    resolveWorkflowAiSchemaFromConfig: vi.fn(() => ({ schema: null, errors: [] })),
    validateExpressionSource: vi.fn(() => []),
  };
});

vi.mock('../WorkflowRunList', () => ({ default: () => <div /> }));
vi.mock('../WorkflowDeadLetterQueue', () => ({ default: () => <div /> }));
vi.mock('../WorkflowEventList', () => ({ default: () => <div /> }));
vi.mock('../WorkflowRunDialog', () => ({ default: () => <div /> }));
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

import { StepConfigPanel } from '../WorkflowDesigner';

const baseDefinition = {
  id: 'wf-1',
  version: 1,
  name: 'Test Workflow',
  payloadSchemaRef: 'payload.Test.v1',
  steps: [],
} as any;

const baseProps = {
  stepPath: 'root.steps[0]',
  errors: [],
  nodeRegistry: {},
  actionRegistry: [],
  designerActionCatalog: [],
  fieldOptions: [],
  payloadSchema: { type: 'object', properties: {} },
  definition: baseDefinition,
  editable: true,
};

describe('Workflow wait editors', () => {
  beforeEach(() => {
    getWorkflowSchemaActionMock.mockReset();
    getEventCatalogEntryByEventTypeMock.mockReset();
    getWorkflowSchemaActionMock.mockResolvedValue({ schema: { type: 'object', properties: {} } });
    getEventCatalogEntryByEventTypeMock.mockResolvedValue(null);
  });

  it('T007: curated wait editors persist key event/time fields through onChange', async () => {
    const onChangeEvent = vi.fn();
    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-step',
          type: 'event.wait',
          config: { eventName: 'project.status.changed', correlationKey: { $expr: 'payload.projectId' }, filters: [] }
        } as any}
        eventCatalogOptions={[
          {
            event_id: 'evt-1',
            event_type: 'project.status.changed',
            name: 'Project Status Changed',
            category: 'Project',
            payload_schema_ref: 'payload.ProjectStatus.v1',
            payload_schema_ref_status: 'known',
            source: 'tenant',
            status: 'active'
          }
        ]}
        onChange={onChangeEvent}
      />
    );

    expect(screen.getByTestId('event-wait-event-event-step')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('event-wait-timeout-event-step'), { target: { value: '5000' } });
    expect(onChangeEvent).toHaveBeenCalled();

    const onChangeTime = vi.fn();
    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-step',
          type: 'time.wait',
          config: { mode: 'duration', durationMs: 1000 }
        } as any}
        eventCatalogOptions={[]}
        onChange={onChangeTime}
      />
    );

    fireEvent.change(screen.getByTestId('time-wait-duration-time-step'), { target: { value: '9000' } });
    expect(onChangeTime).toHaveBeenCalled();
  });

  it('T009: wait-filter editor renders typed picker when schema field has picker metadata', async () => {
    getWorkflowSchemaActionMock.mockResolvedValue({
      schema: {
        type: 'object',
        properties: {
          newStatus: {
            type: 'string',
            'x-workflow-picker-kind': 'ticket-status'
          }
        }
      }
    });

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-picker-step',
          type: 'event.wait',
          config: {
            eventName: 'project.status.changed',
            correlationKey: { $expr: 'payload.projectId' },
            filters: [{ path: 'newStatus', op: '=', value: '' }]
          }
        } as any}
        eventCatalogOptions={[
          {
            event_id: 'evt-2',
            event_type: 'project.status.changed',
            name: 'Project Status Changed',
            category: 'Project',
            payload_schema_ref: 'payload.ProjectStatus.v1',
            payload_schema_ref_status: 'known',
            source: 'tenant',
            status: 'active'
          }
        ]}
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('event-wait-filter-value-event-picker-step-0-typed-picker')).toBeInTheDocument();
    });
  });

  it('T010: wait-filter editor falls back to enum/primitive controls without picker metadata', async () => {
    getWorkflowSchemaActionMock.mockResolvedValue({
      schema: {
        type: 'object',
        properties: {
          newStatus: {
            type: 'string',
            enum: ['Live', 'Complete']
          }
        }
      }
    });

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-fallback-step',
          type: 'event.wait',
          config: {
            eventName: 'project.status.changed',
            correlationKey: { $expr: 'payload.projectId' },
            filters: [{ path: 'newStatus', op: '=', value: 'Live' }]
          }
        } as any}
        eventCatalogOptions={[
          {
            event_id: 'evt-3',
            event_type: 'project.status.changed',
            name: 'Project Status Changed',
            category: 'Project',
            payload_schema_ref: 'payload.ProjectStatus.v1',
            payload_schema_ref_status: 'known',
            source: 'tenant',
            status: 'active'
          }
        ]}
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('event-wait-filter-value-event-fallback-step-0')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('event-wait-filter-value-event-fallback-step-0-typed-picker')).not.toBeInTheDocument();
  });
});
