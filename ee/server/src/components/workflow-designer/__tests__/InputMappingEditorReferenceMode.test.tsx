/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getTicketFieldOptions: vi.fn().mockResolvedValue({
    options: {
      boards: [],
      statuses: [],
      priorities: [],
      categories: [],
      clients: [],
      users: [],
      locations: [],
    },
  }),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: vi.fn().mockResolvedValue([]),
  getContactsByClient: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    options,
    value,
    onValueChange,
    disabled,
  }: {
    id?: string;
    options: Array<{ value: string; label: string; is_inactive?: boolean }>;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">--</option>
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.is_inactive}
        >
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../expression-editor', () => ({
  ExpressionEditor: React.forwardRef(function MockExpressionEditor(
    props: { value?: string; onChange?: (value: string) => void },
    ref: React.ForwardedRef<HTMLTextAreaElement>
  ) {
    return (
      <textarea
        ref={ref}
        data-testid="mock-expression-editor"
        value={props.value ?? ''}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }),
}));

import { InputMappingEditor } from '../mapping/InputMappingEditor';
import type { MappingPositionsHandlers } from '../mapping/useMappingPositions';

const positionsHandlers: MappingPositionsHandlers = {
  registerSourceRef: vi.fn(),
  registerTargetRef: vi.fn(),
  setContainerRef: vi.fn(),
  registerScrollContainer: vi.fn(),
  unregisterScrollContainer: vi.fn(),
  recalculatePositions: vi.fn(),
  getSourcePosition: vi.fn(() => null),
  getTargetPosition: vi.fn(() => null),
  getConnections: vi.fn(() => []),
};

afterEach(() => {
  cleanup();
});

describe('InputMappingEditor reference mode', () => {
  it('replaces the whole expression with a direct field reference when a structured source is chosen', async () => {
    const onChange = vi.fn();

    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: 'payload.previous.id' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
          ]}
          stepId="step-1"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-1-summary-picker'), {
        target: { value: 'payload.ticket.id' },
      });
    });

    expect(onChange).toHaveBeenCalledWith({
      summary: { $expr: 'payload.ticket.id' },
    });
  });

  it('T157: preserves the current reference expression when unrelated upstream options change', async () => {
    const onChange = vi.fn();
    let rerender: ReturnType<typeof render>['rerender'];

    await act(async () => {
      ({ rerender } = render(
        <InputMappingEditor
          value={{ summary: { $expr: 'vars.ticketResult.ticket_id' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' },
          ]}
          stepId="step-1"
          positionsHandlers={positionsHandlers}
        />
      ));
    });

    expect(screen.getByTestId('mock-expression-editor')).toHaveValue('vars.ticketResult.ticket_id');

    await act(async () => {
      rerender(
        <InputMappingEditor
          value={{ summary: { $expr: 'vars.ticketResult.ticket_id' } }}
          onChange={onChange}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'vars.ticketResult.ticket_id', label: 'vars.ticketResult.ticket_id' },
            { value: 'vars.contactResult.email', label: 'vars.contactResult.email' },
          ]}
          stepId="step-1"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(screen.getByTestId('mock-expression-editor')).toHaveValue('vars.ticketResult.ticket_id');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('T287: keeps saved advanced expressions editable when they cannot hydrate into structured Reference mode', async () => {
    await act(async () => {
      render(
        <InputMappingEditor
          value={{ summary: { $expr: 'payload.summary & "-" & meta.traceId' } }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'summary',
              type: 'string',
              required: true,
            },
          ]}
          fieldOptions={[
            { value: 'payload.summary', label: 'payload.summary' },
            { value: 'meta.traceId', label: 'meta.traceId' },
          ]}
          stepId="step-advanced-expression"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(
      screen.getByTestId('mapping-step-advanced-expression-summary-source-mode')
    ).toHaveValue('advanced');
    expect(
      screen.getByTestId('mapping-step-advanced-expression-summary-advanced-mode')
    ).toHaveValue('expression');
    expect(screen.getByTestId('mock-expression-editor')).toHaveValue(
      'payload.summary & "-" & meta.traceId'
    );
  });
});
