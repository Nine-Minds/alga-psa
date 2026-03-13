/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    options: Array<{ value: string; label: string }>;
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
        <option key={option.value} value={option.value}>
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

describe('transform action input editor', () => {
  it('T236/T242/T243/T259/T260: text transform actions use structured references plus fixed numeric and enum parameter controls', async () => {
    const onChange = vi.fn();

    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            text: { $expr: 'payload.summary' },
            maxLength: 24,
            strategy: 'middle',
          }}
          onChange={onChange}
          targetFields={[
            {
              name: 'text',
              type: 'string',
              required: true,
            },
            {
              name: 'maxLength',
              type: 'number',
              required: true,
            },
            {
              name: 'strategy',
              type: 'string',
              enum: ['end', 'start', 'middle'],
            },
          ]}
          fieldOptions={[
            { value: 'payload.summary', label: 'payload.summary' },
            { value: 'payload.ticket.id', label: 'payload.ticket.id' },
          ]}
          stepId="step-transform-inputs"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(screen.getByTestId('mapping-step-transform-inputs-text-source-mode')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-transform-inputs-maxLength-source-mode')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-transform-inputs-text-picker')).toBeInTheDocument();

    expect(screen.getByText('maxLength')).toBeInTheDocument();
    expect(screen.getByText('strategy')).toBeInTheDocument();
    expect(screen.getByTestId('mapping-step-transform-inputs-maxLength-source-mode')).toHaveValue(
      'fixed'
    );
    expect(screen.getByTestId('mapping-step-transform-inputs-strategy-source-mode')).toHaveValue(
      'fixed'
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-transform-inputs-text-picker'), {
        target: { value: 'payload.ticket.id' },
      });
    });

    expect(onChange).toHaveBeenCalledWith({
      text: { $expr: 'payload.ticket.id' },
      maxLength: 24,
      strategy: 'middle',
    });
  });

  it('T237: transform input fields show type-compatibility hints like business action fields', async () => {
    render(
      <InputMappingEditor
        value={{
          text: { $expr: 'payload.ticket' },
          maxLength: 24,
        }}
        onChange={vi.fn()}
        targetFields={[
          {
            name: 'text',
            type: 'string',
            required: true,
          },
          {
            name: 'maxLength',
            type: 'number',
            required: true,
          },
        ]}
        fieldOptions={[{ value: 'payload.ticket', label: 'Payload ticket' }]}
        stepId="step-transform-hints"
        positionsHandlers={positionsHandlers}
        sourceTypeMap={new Map([['payload.ticket', 'object']])}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText('Type "object" is incompatible with expected "string"')
      ).toBeInTheDocument();
    });
  });
});
