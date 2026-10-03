/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const STATUSES = [
  { id: 's1', name: 'Awaiting Wisdom', board_id: 'b1', board_name: 'Urgent Matters' },
  { id: 's2', name: 'Awaiting Wisdom', board_id: 'b2', board_name: 'Support' },
  { id: 's3', name: 'Awaiting Wisdom', board_id: 'b3', board_name: 'Projects' },
  { id: 's4', name: 'Closed', board_id: 'b1', board_name: 'Urgent Matters' },
];

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options, value, onValueChange }: {
    id?: string;
    options: Array<{ value: string; label: string }>;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <select data-testid={id} value={value ?? ''} onChange={(event) => onValueChange?.(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES: new Set(['ticket-status']),
  WorkflowActionInputFixedPicker: ({ idPrefix, value, onChange, includeAnyBoardStatus }: {
    idPrefix: string;
    value: string | null;
    onChange: (value: string | null) => void;
    includeAnyBoardStatus?: boolean;
  }) => (
    <select
      data-testid={`${idPrefix}-picker`}
      data-any-board={String(Boolean(includeAnyBoardStatus))}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">--</option>
      <option value="any-board-status:Awaiting Wisdom">Awaiting Wisdom (any board)</option>
      {STATUSES.map((status) => <option key={status.id} value={status.id}>{status.name} · {status.board_name}</option>)}
    </select>
  ),
}));

vi.mock('../workflowEntityLabels', () => ({
  useWorkflowEntityLabels: () => ({
    labels: new Map(STATUSES.map((status) => [status.id, status.name])),
    statuses: STATUSES,
    loaded: true,
  }),
}));

import { WorkflowConditionBuilder, describeWorkflowCondition } from '../WorkflowConditionBuilder';
import type { WorkflowConditionField } from '../workflowConditionFields';

const t = (key: string, options?: Record<string, unknown>) => {
  let text = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) text = text.replace(`{{${name}}}`, String(value));
  return text;
};

const STATUS: WorkflowConditionField = {
  path: 'vars.ticket.ticket.status_id',
  sourceLabel: 'Find Ticket',
  fieldLabel: 'ticket.status_id',
  type: 'string',
  pickerKind: 'ticket-status',
};
const PATH = STATUS.path;

const renderBuilder = (expression: string) => {
  const onChange = vi.fn();
  render(
    <WorkflowConditionBuilder
      idPrefix="cond"
      label="Condition"
      expression={expression}
      onExpressionChange={onChange}
      fields={[STATUS]}
      renderExpressionEditor={() => null}
    />
  );
  return onChange;
};

describe('ticket status conditions across boards', () => {
  afterEach(() => cleanup());

  it('compiles "any board" to an in list of every status id with that name', () => {
    const onChange = renderBuilder(`${PATH} = ""`);
    const picker = screen.getByTestId('cond-clause-0-value-picker');
    expect(picker.getAttribute('data-any-board')).toBe('true');
    fireEvent.change(picker, { target: { value: 'any-board-status:Awaiting Wisdom' } });
    expect(onChange).toHaveBeenCalledWith(`${PATH} in ["s1", "s2", "s3"]`);
  });

  it('compiles a board-specific choice to = id', () => {
    const onChange = renderBuilder(`${PATH} = ""`);
    fireEvent.change(screen.getByTestId('cond-clause-0-value-picker'), { target: { value: 's1' } });
    expect(onChange).toHaveBeenCalledWith(`${PATH} = "s1"`);
  });

  it('maps "is not" + any board to not_in', () => {
    const onChange = renderBuilder(`${PATH} != ""`);
    fireEvent.change(screen.getByTestId('cond-clause-0-value-picker'), { target: { value: 'any-board-status:Awaiting Wisdom' } });
    expect(onChange).toHaveBeenCalledWith(`(${PATH} in ["s1", "s2", "s3"]) = false`);
  });

  it('reopens an in list that matches one name as that name (any board), not as chips', () => {
    renderBuilder(`${PATH} in ["s1", "s2", "s3"]`);
    expect((screen.getByTestId('cond-clause-0-operator') as HTMLSelectElement).value).toBe('equals');
    expect((screen.getByTestId('cond-clause-0-value-picker') as HTMLSelectElement).value).toBe('any-board-status:Awaiting Wisdom');
    expect(screen.queryByTestId('cond-clause-0-value-item-0-picker')).toBeNull();
  });

  it('reopens not in as "is not"', () => {
    renderBuilder(`(${PATH} in ["s3", "s1", "s2"]) = false`);
    expect((screen.getByTestId('cond-clause-0-operator') as HTMLSelectElement).value).toBe('not_equals');
  });

  it('keeps a partial list as a list', () => {
    renderBuilder(`${PATH} in ["s1", "s2"]`);
    expect((screen.getByTestId('cond-clause-0-operator') as HTMLSelectElement).value).toBe('in');
  });
});

describe('ticket status condition summaries', () => {
  const labels = { labels: new Map(STATUSES.map((s) => [s.id, s.name])), statuses: STATUSES, loaded: true };

  it('says "(any board)" for the shared list', () => {
    expect(describeWorkflowCondition(t, `${PATH} in ["s1", "s2", "s3"]`, labels)).toBe('ticket status is Awaiting Wisdom (any board)');
    expect(describeWorkflowCondition(t, `(${PATH} in ["s1", "s2", "s3"]) = false`, labels)).toBe('ticket status is not Awaiting Wisdom (any board)');
  });

  it('names the board for one board-specific status', () => {
    expect(describeWorkflowCondition(t, `${PATH} = "s1"`, labels)).toBe('ticket status is Awaiting Wisdom (Urgent Matters)');
  });
});
