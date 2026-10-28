// @vitest-environment jsdom

import React, { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getWorkflowSchemaActionMock,
  getEventCatalogEntryByEventTypeMock,
} = vi.hoisted(() => ({
  getWorkflowSchemaActionMock: vi.fn(),
  getEventCatalogEntryByEventTypeMock: vi.fn(),
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

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(async () => null),
  getCurrentUserPermissions: vi.fn(async () => []),
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

// Full factories (no importOriginal): the real server-action modules drag in package dist
// builds that jsdom cannot resolve.
vi.mock('@alga-psa/workflows/actions', () => ({
  getEventCatalogEntryByEventType: (...args: unknown[]) => getEventCatalogEntryByEventTypeMock(...args),
  listEventCatalogOptionsV2Action: vi.fn(async () => ({ events: [] })),
  createWorkflowDefinitionAction: vi.fn(),
  getWorkflowSchemaAction: (...args: unknown[]) => getWorkflowSchemaActionMock(...args),
  getWorkflowDefinitionVersionAction: vi.fn(),
  listWorkflowDesignerActionCatalogAction: vi.fn(async () => []),
  listWorkflowSchemaRefsAction: vi.fn(async () => ({ refs: [] })),
  listWorkflowSchemasMetaAction: vi.fn(async () => ({ schemas: [] })),
  listWorkflowDefinitionsAction: vi.fn(async () => []),
  listWorkflowRegistryActionsAction: vi.fn(async () => []),
  listWorkflowRegistryNodesAction: vi.fn(async () => []),
  listWorkflowRunsAction: vi.fn(async () => []),
  getWorkflowStepQuotaSummaryAction: vi.fn(async () => null),
  publishWorkflowDefinitionAction: vi.fn(),
  updateWorkflowDefinitionDraftAction: vi.fn(),
  updateWorkflowDefinitionMetadataAction: vi.fn(),
}));

vi.mock('@alga-psa/workflows/runtime', () => ({
  buildWorkflowDesignerActionCatalog: vi.fn(() => []),
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF: 'payload.WorkflowClock.v1',
  isWorkflowAiInferAction: vi.fn(() => false),
  resolveWorkflowAiSchemaFromConfig: vi.fn(() => ({ schema: null, errors: [] })),
  validateExpressionSource: vi.fn(() => []),
}));

vi.mock('@alga-psa/workflows/authoring', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('@alga-psa/workflows/authoring')),
  buildWorkflowDesignerActionCatalog: vi.fn(() => []),
  WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF: 'payload.WorkflowClock.v1',
  isWorkflowAiInferAction: vi.fn(() => false),
  isWorkflowComposeTextAction: vi.fn(() => false),
  resolveComposeTextOutputSchemaFromConfig: vi.fn(() => ({ schema: null, errors: [] })),
  resolveWorkflowAiSchemaFromConfig: vi.fn(() => ({ schema: null, errors: [] })),
  validateExpressionSource: vi.fn(() => []),
}));

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

import { MappingExprEditor } from '../WorkflowDesigner';

type Mapping = Record<string, { $expr: string }>;

const Harness: React.FC<{ initial: Mapping; onChange: (value: Mapping) => void }> = ({ initial, onChange }) => {
  const [value, setValue] = useState<Mapping>(initial);

  return (
    <MappingExprEditor
      idPrefix="map"
      label="Assignments"
      value={value as any}
      onChange={(next) => {
        setValue(next as Mapping);
        onChange(next as Mapping);
      }}
      fieldOptions={[]}
    />
  );
};

const keyInputs = (): HTMLInputElement[] => [
  ...document.querySelectorAll<HTMLInputElement>('input[id^="map-key-"]'),
];

describe('MappingExprEditor variable names', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the name input focused and in place while it is renamed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        initial={{ field_1: { $expr: 'payload.a' }, field_2: { $expr: 'payload.b' } }}
        onChange={onChange}
      />
    );

    const input = document.getElementById('map-key-0') as HTMLInputElement;
    await user.click(input);
    await user.type(input, 'sen');

    // Same DOM node: the row never remounted, so focus and the full typed string survive.
    expect(document.getElementById('map-key-0')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('field_1sen');

    // Row order is preserved; the renamed key stays first in the emitted record.
    expect(keyInputs().map((element) => element.value)).toEqual(['field_1sen', 'field_2']);
    const emitted = onChange.mock.calls.at(-1)?.[0];
    expect(Object.keys(emitted)).toEqual(['field_1sen', 'field_2']);
    expect(emitted).toEqual({ field_1sen: { $expr: 'payload.a' }, field_2: { $expr: 'payload.b' } });
  });

  it('keeps a cleared name on screen and omits it from the emitted mapping', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        initial={{ field_1: { $expr: 'payload.a' }, field_2: { $expr: 'payload.b' } }}
        onChange={onChange}
      />
    );

    const input = document.getElementById('map-key-0') as HTMLInputElement;
    await user.clear(input);

    expect(document.getElementById('map-key-0')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('');
    expect(keyInputs()).toHaveLength(2);
    expect(screen.getByText('Enter a name for this mapping.')).toBeInTheDocument();
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ field_2: { $expr: 'payload.b' } });

    await user.type(input, 'sender');

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('sender');
    const emitted = onChange.mock.calls.at(-1)?.[0];
    expect(Object.keys(emitted)).toEqual(['sender', 'field_2']);
  });

  it('adds the first unused field name instead of overwriting an existing row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Harness
        initial={{ field_1: { $expr: 'payload.a' }, field_2: { $expr: 'payload.b' } }}
        onChange={onChange}
      />
    );

    await user.click(document.getElementById('map-remove-0') as HTMLButtonElement);
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual({ field_2: { $expr: 'payload.b' } });

    await user.click(document.getElementById('map-add') as HTMLButtonElement);

    const emitted = onChange.mock.calls.at(-1)?.[0];
    expect(Object.keys(emitted)).toEqual(['field_2', 'field_1']);
    expect(emitted.field_2).toEqual({ $expr: 'payload.b' });
    expect(emitted.field_1).toEqual({ $expr: '' });
  });
});
