/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { selectMock } = vi.hoisted(() => ({ selectMock: ({
  id,
  options,
  value,
  onValueChange,
  onChange,
  disabled,
}: {
  id?: string;
  options: Array<{ value: string; label: string }>;
  value?: string | null;
  onValueChange?: (value: string) => void;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) => (
  <select
    data-testid={id}
    value={value ?? ''}
    disabled={disabled}
    onChange={(event) => (onValueChange ?? onChange)?.(event.target.value)}
  >
    <option value="">--</option>
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
) }));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ __esModule: true, default: selectMock }));
vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({ __esModule: true, default: selectMock }));

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES: new Set(['ticket-priority', 'board']),
  WorkflowActionInputFixedPicker: ({
    idPrefix,
    field,
    value,
    onChange,
  }: {
    idPrefix: string;
    field: { editor?: { picker?: { resource: string } } };
    value: string | null;
    onChange: (value: string | null) => void;
  }) => (
    <select
      data-testid={`${idPrefix}-entity-picker`}
      data-kind={field.editor?.picker?.resource}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">--</option>
      <option value="p1">P1 - Critical</option>
      <option value="p2">P2 - High</option>
    </select>
  ),
}));

vi.mock('../workflowEntityLabels', () => ({
  useWorkflowEntityLabels: () => ({ labels: new Map([['p1', 'P1 - Critical']]), loaded: true }),
}));

import {
  WorkflowConditionBuilder,
  describeWorkflowCondition,
  getConditionOperatorsForField,
  humanizeConditionFieldName,
} from '../WorkflowConditionBuilder';
import type { WorkflowConditionField } from '../workflowConditionFields';

const t = (key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    text = text.replace(`{{${name}}}`, String(value));
  }
  return text;
};

const PRIORITY: WorkflowConditionField = {
  path: 'vars.ticketDetails.ticket.priority_id',
  sourceLabel: 'Find Ticket',
  fieldLabel: 'ticket.priority_id',
  type: 'string',
  pickerKind: 'ticket-priority',
};
const TITLE: WorkflowConditionField = {
  path: 'vars.ticketDetails.ticket.title',
  sourceLabel: 'Find Ticket',
  fieldLabel: 'ticket.title',
  type: 'string',
};

const renderBuilder = (expression: string, onExpressionChange = vi.fn()) => {
  render(
    <WorkflowConditionBuilder
      idPrefix="cond"
      label="Condition"
      expression={expression}
      onExpressionChange={onExpressionChange}
      fields={[PRIORITY, TITLE]}
      renderExpressionEditor={() => <textarea data-testid="raw-expression" defaultValue={expression} />}
    />
  );
  return onExpressionChange;
};

describe('WorkflowConditionBuilder', () => {
  afterEach(() => cleanup());

  it('starts in builder mode; Add condition opens an empty row and writes the clause once a field is picked', () => {
    const onChange = renderBuilder('');
    expect(screen.queryByTestId('raw-expression')).toBeNull();
    fireEvent.click(screen.getByText('Add condition'));
    // Nothing is chosen for the author: no clause is written until a field is picked.
    expect(onChange).not.toHaveBeenCalled();
    const picker = screen.getByTestId('cond-clause-new-field') as HTMLSelectElement;
    expect(picker.value).toBe('');
    fireEvent.change(picker, { target: { value: 'vars.ticketDetails.ticket.priority_id' } });
    expect(onChange).toHaveBeenCalledWith('vars.ticketDetails.ticket.priority_id = ""');
  });

  it('offers the entity picker for entity id fields and writes the picked id', () => {
    const onChange = renderBuilder('vars.ticketDetails.ticket.priority_id = ""');
    const picker = screen.getByTestId('cond-clause-0-value-entity-picker');
    expect(picker.getAttribute('data-kind')).toBe('ticket-priority');
    fireEvent.change(picker, { target: { value: 'p1' } });
    expect(onChange).toHaveBeenCalledWith('vars.ticketDetails.ticket.priority_id = "p1"');
  });

  it('switches the value editor to a list for "is any of"', () => {
    const onChange = renderBuilder('vars.ticketDetails.ticket.priority_id = "p1"');
    fireEvent.change(screen.getByTestId('cond-clause-0-operator'), { target: { value: 'in' } });
    expect(onChange).toHaveBeenCalledWith('vars.ticketDetails.ticket.priority_id in ["p1"]');
  });

  it('resets the operator and value when the field changes to one that does not support them', () => {
    const onChange = renderBuilder('vars.ticketDetails.ticket.priority_id = "p1"');
    fireEvent.change(screen.getByTestId('cond-clause-0-field'), { target: { value: TITLE.path } });
    expect(onChange).toHaveBeenCalledWith('vars.ticketDetails.ticket.title = ""');
  });

  it('falls back to the expression editor for conditions the builder cannot show', () => {
    renderBuilder('vars.a = 1 and (vars.b = 2 or vars.c = 3)');
    expect(screen.getByTestId('raw-expression')).toBeTruthy();
    expect((document.getElementById('cond-mode-builder') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/can only be edited as an expression/)).toBeTruthy();
  });

  it('lets the user switch a builder-shaped condition to expression mode', () => {
    renderBuilder('vars.ticketDetails.ticket.title = "x"');
    fireEvent.click(document.getElementById('cond-mode-expression') as HTMLButtonElement);
    expect(screen.getByTestId('raw-expression')).toBeTruthy();
  });
});

describe('condition helpers', () => {
  it('limits operators to what fits the field', () => {
    expect(getConditionOperatorsForField(PRIORITY)).toEqual(['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty']);
    expect(getConditionOperatorsForField({ ...TITLE, type: 'boolean' })).toEqual(['equals', 'not_equals']);
    expect(getConditionOperatorsForField(TITLE)).toContain('contains');
  });

  it('humanizes field names', () => {
    expect(humanizeConditionFieldName('ticket.priority_id')).toBe('priority');
    expect(humanizeConditionFieldName('payload.assignedToUserId')).toBe('assigned to user');
    expect(humanizeConditionFieldName('ticket.title')).toBe('title');
  });

  it('describes conditions with entity names', () => {
    const labels = { labels: new Map([['p1', 'P1 - Critical']]), loaded: true };
    expect(describeWorkflowCondition(t, 'vars.x.ticket.priority_id = "p1" and vars.x.ticket.title != ""', labels))
      .toBe('ticket priority is P1 - Critical and ticket title is not ""');
    expect(describeWorkflowCondition(t, 'vars.recheck.ticket.is_closed = false', labels)).toBe('ticket is closed is false');
    expect(describeWorkflowCondition(t, 'payload.clientName != ""', labels)).toBe('client name is not ""');
    expect(describeWorkflowCondition(t, 'len(vars.x) > 0', labels)).toBeNull();
    expect(describeWorkflowCondition(t, '', labels)).toBeNull();
  });

  it('never shows a bare id: a placeholder while names load, then "unknown <field>"', () => {
    const priorityId = '5f0c2a1e-8d3b-4c7a-9e21-0b6d4f8a7c33';
    const expression = `vars.x.ticket.priority_id = "${priorityId}" and vars.x.ticket.title = "${priorityId}x"`;
    expect(describeWorkflowCondition(t, expression, { labels: new Map(), loaded: false }))
      .toBe(`ticket priority is … and ticket title is "${priorityId}x"`);
    expect(describeWorkflowCondition(t, expression, { labels: new Map(), loaded: true }))
      .toBe(`ticket priority is unknown priority and ticket title is "${priorityId}x"`);
    expect(describeWorkflowCondition(t, expression, { labels: new Map([[priorityId, 'P2 - High']]), loaded: true }))
      .toBe(`ticket priority is P2 - High and ticket title is "${priorityId}x"`);
  });
});
