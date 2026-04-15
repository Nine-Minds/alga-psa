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

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ id, value, onChange, disabled }: any) => (
    <input
      id={id}
      data-testid={id}
      value={value instanceof Date ? value.toISOString() : ''}
      onChange={(event) => onChange?.(event.target.value ? new Date(event.target.value) : undefined)}
      disabled={disabled}
    />
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

const workflowActionInputFixedPickerMock = vi.fn(({ idPrefix, rootInputMapping }: { idPrefix: string; rootInputMapping?: unknown }) => (
  <div
    data-testid={`${idPrefix}-typed-picker`}
    data-root-input-mapping={JSON.stringify(rootInputMapping ?? {})}
  />
));

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: (props: any) => workflowActionInputFixedPickerMock(props)
}));

vi.mock('@alga-psa/workflows/actions', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@alga-psa/workflows/actions');
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
  const actual = await importOriginal() as typeof import('@alga-psa/workflows/runtime');
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
vi.mock('../WorkflowStepSaveOutputSection', () => ({
  WorkflowStepSaveOutputSection: ({ stepId }: { stepId: string }) => (
    <div data-testid={`workflow-step-save-output-${stepId}`} />
  )
}));
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
    workflowActionInputFixedPickerMock.mockClear();
    getWorkflowSchemaActionMock.mockReset();
    getEventCatalogEntryByEventTypeMock.mockReset();
    getWorkflowSchemaActionMock.mockResolvedValue({ schema: { type: 'object', properties: {} } });
    getEventCatalogEntryByEventTypeMock.mockResolvedValue(null);
  });

  it('does not render generic save output controls for wait steps', () => {
    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-step-no-save-output',
          type: 'event.wait',
          config: { eventName: 'project.status.changed', correlationKey: { $expr: 'payload.projectId' }, filters: [] }
        } as any}
        eventCatalogOptions={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByTestId('workflow-step-save-output-event-step-no-save-output')).not.toBeInTheDocument();

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-step-no-save-output',
          type: 'time.wait',
          config: { mode: 'duration', durationMs: 1000 }
        } as any}
        eventCatalogOptions={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByTestId('workflow-step-save-output-time-step-no-save-output')).not.toBeInTheDocument();
  });

  it('strips stale saveAs values from existing wait-step configs', async () => {
    const onChange = vi.fn();

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-step-strip-save-output',
          type: 'event.wait',
          config: {
            eventName: 'project.status.changed',
            correlationKey: { $expr: 'payload.projectId' },
            filters: [],
            saveAs: 'should-be-removed'
          }
        } as any}
        eventCatalogOptions={[]}
        onChange={onChange}
      />
    );

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0];
      expect(lastCall?.config?.saveAs).toBeUndefined();
    });
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

    fireEvent.change(screen.getByTestId('time-wait-duration-minutes-time-step'), { target: { value: '2' } });
    expect(onChangeTime).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        mode: 'duration',
        durationMs: 121000
      })
    }));
  });

  it('decomposes duration waits into day/hour/minute/second fields', () => {
    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-step-parts',
          type: 'time.wait',
          config: { mode: 'duration', durationMs: 90061000 }
        } as any}
        eventCatalogOptions={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('time-wait-duration-days-time-step-parts')).toHaveValue(1);
    expect(screen.getByTestId('time-wait-duration-hours-time-step-parts')).toHaveValue(1);
    expect(screen.getByTestId('time-wait-duration-minutes-time-step-parts')).toHaveValue(1);
    expect(screen.getByTestId('time-wait-duration-seconds-time-step-parts')).toHaveValue(1);
  });

  it('renders fixed-date authoring for parseable until literals and advanced authoring for dynamic expressions', () => {
    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-fixed-step',
          type: 'time.wait',
          config: { mode: 'until', until: { $expr: '"2026-04-14T17:00:00.000Z"' } }
        } as any}
        eventCatalogOptions={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('time-wait-until-authoring-mode-time-fixed-step')).toHaveValue('fixed');
    expect(screen.getByTestId('time-wait-until-picker-time-fixed-step')).toHaveValue('2026-04-14T17:00:00.000Z');

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-expression-step',
          type: 'time.wait',
          config: { mode: 'until', until: { $expr: 'payload.runAt' } }
        } as any}
        eventCatalogOptions={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('time-wait-until-authoring-mode-time-expression-step')).toHaveValue('expression');
    expect(screen.getByTestId('Until expression')).toHaveValue('payload.runAt');
  });

  it('writes picker-authored until values as quoted ISO expressions and preserves them when switching to advanced mode', () => {
    const onChange = vi.fn();

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-picker-step',
          type: 'time.wait',
          config: { mode: 'until', until: { $expr: '' } }
        } as any}
        eventCatalogOptions={[]}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByTestId('time-wait-until-picker-time-picker-step'), {
      target: { value: '2026-04-14T17:00:00.000Z' }
    });

    const lastPickerCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastPickerCall?.config?.until).toEqual({ $expr: '"2026-04-14T17:00:00.000Z"' });

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-picker-preserve-step',
          type: 'time.wait',
          config: { mode: 'until', until: { $expr: '"2026-04-14T17:00:00.000Z"' } }
        } as any}
        eventCatalogOptions={[]}
        onChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId('time-wait-until-authoring-mode-time-picker-preserve-step'), {
      target: { value: 'expression' }
    });

    expect(screen.getByTestId('Until expression')).toHaveValue('"2026-04-14T17:00:00.000Z"');
  });

  it('keeps dynamic advanced expressions until the user explicitly overwrites them from the fixed picker', () => {
    const onChange = vi.fn();

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'time-dynamic-step',
          type: 'time.wait',
          config: { mode: 'until', until: { $expr: 'payload.runAt' } }
        } as any}
        eventCatalogOptions={[]}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByTestId('time-wait-until-authoring-mode-time-dynamic-step'), {
      target: { value: 'fixed' }
    });

    expect(screen.getByTestId('time-wait-until-picker-time-dynamic-step')).toHaveValue('');

    fireEvent.change(screen.getByTestId('time-wait-until-picker-time-dynamic-step'), {
      target: { value: '2026-05-01T09:15:00.000Z' }
    });

    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.config?.until).toEqual({ $expr: '"2026-05-01T09:15:00.000Z"' });
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

  it('clears filter values for exists/not_exists operators so the config stays publishable', async () => {
    const onChange = vi.fn();
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
          id: 'event-exists-step',
          type: 'event.wait',
          config: {
            eventName: 'project.status.changed',
            correlationKey: { $expr: 'payload.projectId' },
            filters: [{ path: 'newStatus', op: '=', value: 'Live' }]
          }
        } as any}
        eventCatalogOptions={[
          {
            event_id: 'evt-exists',
            event_type: 'project.status.changed',
            name: 'Project Status Changed',
            category: 'Project',
            payload_schema_ref: 'payload.ProjectStatus.v1',
            payload_schema_ref_status: 'known',
            source: 'tenant',
            status: 'active'
          }
        ]}
        onChange={onChange}
      />
    );

    const operatorSelect = await screen.findByTestId('event-wait-filter-op-event-exists-step-0');
    fireEvent.change(operatorSelect, { target: { value: 'exists' } });

    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.config?.filters?.[0]?.op).toBe('exists');
    expect(lastCall?.config?.filters?.[0]?.value).toBeUndefined();
  });

  it('passes sibling equality filters into typed picker dependency mapping', async () => {
    getWorkflowSchemaActionMock.mockResolvedValue({
      schema: {
        type: 'object',
        properties: {
          board_id: {
            type: 'string'
          },
          status_id: {
            type: 'string',
            'x-workflow-picker-kind': 'ticket-status',
            'x-workflow-picker-dependencies': ['board_id']
          }
        }
      }
    });

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-dependency-step',
          type: 'event.wait',
          config: {
            eventName: 'ticket.status.changed',
            correlationKey: { $expr: 'payload.ticketId' },
            filters: [
              { path: 'board_id', op: '=', value: 'board-1' },
              { path: 'status_id', op: '=', value: '' }
            ]
          }
        } as any}
        eventCatalogOptions={[
          {
            event_id: 'evt-4',
            event_type: 'ticket.status.changed',
            name: 'Ticket Status Changed',
            category: 'Ticket',
            payload_schema_ref: 'payload.TicketStatus.v1',
            payload_schema_ref_status: 'known',
            source: 'tenant',
            status: 'active'
          }
        ]}
        onChange={vi.fn()}
      />
    );

    const picker = await screen.findByTestId('event-wait-filter-value-event-dependency-step-1-typed-picker');
    expect(picker.getAttribute('data-root-input-mapping')).toContain('"board_id":"board-1"');
  });

  it('falls back to enum/primitive controls when picker metadata is unsupported', async () => {
    getWorkflowSchemaActionMock.mockResolvedValue({
      schema: {
        type: 'object',
        properties: {
          newStatus: {
            type: 'string',
            enum: ['Live', 'Complete'],
            'x-workflow-picker-kind': 'unsupported-picker'
          }
        }
      }
    });

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-unsupported-picker-step',
          type: 'event.wait',
          config: {
            eventName: 'project.status.changed',
            correlationKey: { $expr: 'payload.projectId' },
            filters: [{ path: 'newStatus', op: '=', value: 'Live' }]
          }
        } as any}
        eventCatalogOptions={[
          {
            event_id: 'evt-unsupported',
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
      expect(screen.getByTestId('event-wait-filter-value-event-unsupported-picker-step-0')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('event-wait-filter-value-event-unsupported-picker-step-0-typed-picker')).not.toBeInTheDocument();
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

  it('preserves numeric array values for in/not_in filters instead of coercing them to strings', async () => {
    const onChange = vi.fn();
    getWorkflowSchemaActionMock.mockResolvedValue({
      schema: {
        type: 'object',
        properties: {
          priority: {
            type: 'number'
          }
        }
      }
    });

    render(
      <StepConfigPanel
        {...baseProps}
        step={{
          id: 'event-array-step',
          type: 'event.wait',
          config: {
            eventName: 'project.priority.changed',
            correlationKey: { $expr: 'payload.projectId' },
            filters: [{ path: 'priority', op: 'in', value: [1] }]
          }
        } as any}
        eventCatalogOptions={[
          {
            event_id: 'evt-5',
            event_type: 'project.priority.changed',
            name: 'Project Priority Changed',
            category: 'Project',
            payload_schema_ref: 'payload.ProjectPriority.v1',
            payload_schema_ref_status: 'known',
            source: 'tenant',
            status: 'active'
          }
        ]}
        onChange={onChange}
      />
    );

    const input = await screen.findByTestId('event-wait-filter-value-event-array-step-0');
    fireEvent.change(input, { target: { value: '1, 2, 3' } });

    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.config?.filters?.[0]?.value).toEqual([1, 2, 3]);
  });
});
