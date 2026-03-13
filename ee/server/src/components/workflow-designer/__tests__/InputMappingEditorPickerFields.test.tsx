/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/tenancy/actions', () => ({
  listTenantSecrets: vi.fn().mockResolvedValue([]),
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
    <div id={id ? `${id}-container` : undefined}>
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
    </div>
  ),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getTicketFieldOptions: vi.fn().mockResolvedValue({
    options: {
      boards: [{ id: 'board-1', name: 'Support Board' }],
      statuses: [{ id: 'status-1', name: 'New' }],
      priorities: [{ id: 'priority-1', name: 'High' }],
      categories: [
        { id: 'category-1', name: 'Hardware', parent_id: null, board_id: 'board-1' },
        { id: 'subcategory-1', name: 'Printer', parent_id: 'category-1', board_id: 'board-1' },
      ],
      clients: [{ id: 'client-1', name: 'Acme' }],
      users: [{ id: 'user-1', name: 'Alex Agent' }],
      locations: [{ id: 'location-1', name: 'HQ', client_id: 'client-1' }],
    },
  }),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: vi.fn().mockResolvedValue([
    {
      contact_name_id: 'contact-1',
      full_name: 'Taylor Contact',
      email: 'taylor@example.com',
      client_id: 'client-1',
    },
  ]),
  getContactsByClient: vi.fn().mockResolvedValue([
    {
      contact_name_id: 'contact-1',
      full_name: 'Taylor Contact',
      email: 'taylor@example.com',
      client_id: 'client-1',
    },
  ]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn().mockResolvedValue([
    {
      team_id: 'team-1',
      team_name: 'Dispatch',
    },
  ]),
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

describe('InputMappingEditor picker-backed fields', () => {
  it('T166/T181/T182/T183/T184/T185/T186/T187/T188/T189/T190: renders ticket-core picker-backed fields with picker UI in fixed mode', async () => {
    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            board_id: 'board-1',
            client_id: 'client-1',
            contact_id: 'contact-1',
            status_id: 'status-1',
            priority_id: 'priority-1',
            assigned_to: 'user-1',
            category_id: 'category-1',
            subcategory_id: 'subcategory-1',
            location_id: 'location-1',
            assignee: {
              type: 'team',
              id: 'team-1',
            },
          }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'board_id',
              type: 'string',
              picker: { kind: 'board', allowsDynamicReference: true },
            },
            {
              name: 'client_id',
              type: 'string',
              picker: { kind: 'client', allowsDynamicReference: true },
            },
            {
              name: 'contact_id',
              type: 'string',
              picker: {
                kind: 'contact',
                dependencies: ['client_id'],
                allowsDynamicReference: true,
              },
            },
            {
              name: 'status_id',
              type: 'string',
              picker: { kind: 'ticket-status', allowsDynamicReference: true },
            },
            {
              name: 'priority_id',
              type: 'string',
              picker: { kind: 'ticket-priority', allowsDynamicReference: true },
            },
            {
              name: 'assigned_to',
              type: 'string',
              picker: { kind: 'user', allowsDynamicReference: true },
            },
            {
              name: 'category_id',
              type: 'string',
              picker: {
                kind: 'ticket-category',
                dependencies: ['board_id'],
                allowsDynamicReference: true,
              },
            },
            {
              name: 'subcategory_id',
              type: 'string',
              picker: {
                kind: 'ticket-subcategory',
                dependencies: ['board_id', 'category_id'],
                allowsDynamicReference: true,
              },
            },
            {
              name: 'location_id',
              type: 'string',
              picker: {
                kind: 'client-location',
                dependencies: ['client_id'],
                allowsDynamicReference: true,
              },
            },
            {
              name: 'assignee',
              type: 'object',
              children: [
                {
                  name: 'type',
                  type: 'string',
                  enum: ['user', 'team'],
                },
                {
                  name: 'id',
                  type: 'string',
                  picker: {
                    kind: 'user-or-team',
                    dependencies: ['assignee.type'],
                    allowsDynamicReference: true,
                  },
                },
              ],
            },
          ]}
          fieldOptions={[]}
          stepId="step-ticket-pickers"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(
      document.getElementById('mapping-step-ticket-pickers-board_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-client_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-contact_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-status_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-priority_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-assigned_to-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-category_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-subcategory_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-location_id-literal-picker-container')
    ).toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-assignee.id-literal-picker-container')
    ).toBeInTheDocument();

    expect(
      document.getElementById('mapping-step-ticket-pickers-board_id-literal-str')
    ).not.toBeInTheDocument();
    expect(
      document.getElementById('mapping-step-ticket-pickers-contact_id-literal-str')
    ).not.toBeInTheDocument();
  });

  it('T167/T168/T191/T192/T193/T194/T195/T196/T197/T198/T199: picker-backed fields can switch to reference or advanced mode and back to fixed without losing picker UI', async () => {
    const changeSpy = vi.fn();

    const Harness = () => {
      const [value, setValue] = React.useState({
        board_id: 'board-1',
      });

      return (
        <InputMappingEditor
          value={value}
          onChange={(nextValue) => {
            changeSpy(nextValue);
            setValue(nextValue as typeof value);
          }}
          targetFields={[
            {
              name: 'board_id',
              type: 'string',
              picker: { kind: 'board', allowsDynamicReference: true },
            },
          ]}
          fieldOptions={[{ value: 'payload.board.id', label: 'payload.board.id' }]}
          stepId="step-picker-modes"
          positionsHandlers={positionsHandlers}
        />
      );
    };

    await act(async () => {
      render(<Harness />);
    });

    expect(
      document.getElementById('mapping-step-picker-modes-board_id-literal-picker-container')
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-picker-modes-board_id-source-mode'), {
        target: { value: 'reference' },
      });
    });

    expect(changeSpy).toHaveBeenLastCalledWith({
      board_id: {
        $expr: '',
      },
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-picker-modes-board_id-source-mode'), {
        target: { value: 'advanced' },
      });
      fireEvent.change(screen.getByTestId('mapping-step-picker-modes-board_id-advanced-mode'), {
        target: { value: 'expression' },
      });
      fireEvent.change(screen.getByTestId('mapping-step-picker-modes-board_id-source-mode'), {
        target: { value: 'fixed' },
      });
    });

    expect(
      document.getElementById('mapping-step-picker-modes-board_id-literal-picker-container')
    ).toBeInTheDocument();
  });

  it('T200: selecting a fixed picker value persists the literal identifier inside inputMapping', async () => {
    const Harness = () => {
      const [value, setValue] = React.useState({
        board_id: '',
      });

      return (
        <>
          <InputMappingEditor
            value={value}
            onChange={(nextValue) => setValue(nextValue as typeof value)}
            targetFields={[
              {
                name: 'board_id',
                type: 'string',
                picker: { kind: 'board', allowsDynamicReference: true },
              },
            ]}
            fieldOptions={[]}
            stepId="step-picker-persist"
            positionsHandlers={positionsHandlers}
          />
          <output data-testid="mapping-value">{JSON.stringify(value)}</output>
        </>
      );
    };

    await act(async () => {
      render(<Harness />);
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-picker-persist-board_id-literal-picker'), {
        target: { value: 'board-1' },
      });
    });

    expect(screen.getByTestId('mapping-value').textContent).toBe(
      JSON.stringify({ board_id: 'board-1' })
    );
  });
});
