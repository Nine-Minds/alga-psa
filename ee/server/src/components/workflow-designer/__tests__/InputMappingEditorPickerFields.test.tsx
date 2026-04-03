/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  BoardPicker: ({
    id,
    boards,
    selectedBoardId,
    onSelect,
  }: {
    id?: string;
    boards: Array<{ board_id?: string; board_name?: string }>;
    selectedBoardId: string | null;
    onSelect: (value: string) => void;
  }) => (
    <div id={id ? `${id}-container` : undefined}>
      <select
        data-testid={id}
        value={selectedBoardId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">--</option>
        {boards.map((board) => (
          <option key={board.board_id} value={board.board_id}>
            {board.board_name}
          </option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({
    id,
    clients,
    selectedClientId,
    onSelect,
  }: {
    id?: string;
    clients: Array<{ client_id: string; client_name: string }>;
    selectedClientId: string | null;
    onSelect: (value: string | null) => void;
  }) => (
    <div id={id ? `${id}-container` : undefined}>
      <select
        data-testid={id}
        value={selectedClientId ?? ''}
        onChange={(event) => onSelect(event.target.value || null)}
      >
        <option value="">--</option>
        {clients.map((client) => (
          <option key={client.client_id} value={client.client_id}>
            {client.client_name}
          </option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({
    id,
    contacts,
    value,
    onValueChange,
    clientId,
  }: {
    id?: string;
    contacts: Array<{ contact_name_id: string; full_name: string; client_id?: string | null }>;
    value: string;
    onValueChange: (value: string) => void;
    clientId?: string;
  }) => (
    <div id={id ? `${id}-container` : undefined}>
      <select
        data-testid={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="">--</option>
        {contacts
          .filter((contact) => !clientId || contact.client_id === clientId)
          .map((contact) => (
            <option key={contact.contact_name_id} value={contact.contact_name_id}>
              {contact.full_name}
            </option>
          ))}
      </select>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: ({
    id,
    users,
    value,
    onValueChange,
  }: {
    id?: string;
    users: Array<{ user_id: string; first_name?: string; last_name?: string; username?: string }>;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <div id={id ? `${id}-container` : undefined}>
      <select
        data-testid={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="">--</option>
        {users.map((user) => (
          <option key={user.user_id} value={user.user_id}>
            {`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username || user.user_id}
          </option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: ({
    id,
    users,
    teams,
    value,
    onValueChange,
    onTeamSelect,
  }: {
    id?: string;
    users: Array<{ user_id: string; first_name?: string; last_name?: string; username?: string }>;
    teams: Array<{ team_id: string; team_name: string }>;
    value: string;
    onValueChange: (value: string) => void;
    onTeamSelect?: (value: string) => void;
  }) => (
    <div id={id ? `${id}-container` : undefined}>
      <select
        data-testid={id}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (teams.some((team) => team.team_id === nextValue)) {
            onTeamSelect?.(nextValue);
            return;
          }
          onValueChange(nextValue);
        }}
      >
        <option value="">--</option>
        {users.map((user) => (
          <option key={user.user_id} value={user.user_id}>
            {`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username || user.user_id}
          </option>
        ))}
        {teams.map((team) => (
          <option key={team.team_id} value={team.team_id}>
            {team.team_name}
          </option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('../../../../../packages/tickets/src/components/CategoryPicker', () => ({
  __esModule: true,
  default: ({
    id,
    categories,
    selectedCategories,
    onSelect,
  }: {
    id?: string;
    categories: Array<{ category_id: string; category_name: string }>;
    selectedCategories: string[];
    onSelect: (selected: string[], excluded: string[]) => void;
  }) => (
    <div id={id ? `${id}-container` : undefined}>
      <select
        data-testid={id}
        value={selectedCategories[0] ?? ''}
        onChange={(event) => onSelect(event.target.value ? [event.target.value] : [], [])}
      >
        <option value="">--</option>
        {categories.map((category) => (
          <option key={category.category_id} value={category.category_id}>
            {category.category_name}
          </option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getTicketFieldOptions: vi.fn().mockResolvedValue({
    options: {
      boards: [
        { id: 'board-1', name: 'Support Board' },
        { id: 'board-2', name: 'Projects Board' },
      ],
      statuses: [
        { id: 'status-1', name: 'New' },
        { id: 'status-2', name: 'Planning' },
      ],
      priorities: [{ id: 'priority-1', name: 'High' }],
      categories: [
        { id: 'category-1', name: 'Hardware', parent_id: null, board_id: 'board-1' },
        { id: 'category-2', name: 'Networking', parent_id: null, board_id: 'board-2' },
        { id: 'subcategory-1', name: 'Printer', parent_id: 'category-1', board_id: 'board-1' },
        { id: 'subcategory-2', name: 'Router', parent_id: 'category-2', board_id: 'board-2' },
      ],
      clients: [
        { id: 'client-1', name: 'Acme' },
        { id: 'client-2', name: 'Globex' },
      ],
      users: [{ id: 'user-1', name: 'Alex Agent' }],
      locations: [
        { id: 'location-1', name: 'Acme HQ', client_id: 'client-1' },
        { id: 'location-2', name: 'Globex Office', client_id: 'client-2' },
      ],
    },
  }),
  getAvailableStatuses: vi.fn().mockImplementation(async (boardId: string | null) => {
    if (boardId === 'board-1') {
      return { statuses: [{ id: 'status-1', name: 'New' }] };
    }

    if (boardId === 'board-2') {
      return { statuses: [{ id: 'status-2', name: 'Planning' }] };
    }

    return { statuses: [] };
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
    {
      contact_name_id: 'contact-keep',
      full_name: 'Shared Contact',
      email: 'shared@example.com',
      client_id: 'client-1',
    },
    {
      contact_name_id: 'contact-2',
      full_name: 'Morgan Contact',
      email: 'morgan@example.com',
      client_id: 'client-2',
    },
  ]),
  getContactsByClient: vi.fn().mockImplementation(async (clientId: string) => {
    if (clientId === 'client-1') {
      return [
        {
          contact_name_id: 'contact-1',
          full_name: 'Taylor Contact',
          email: 'taylor@example.com',
          client_id: 'client-1',
        },
        {
          contact_name_id: 'contact-keep',
          full_name: 'Shared Contact',
          email: 'shared@example.com',
          client_id: 'client-1',
        },
      ];
    }

    if (clientId === 'client-2') {
      return [
        {
          contact_name_id: 'contact-2',
          full_name: 'Morgan Contact',
          email: 'morgan@example.com',
          client_id: 'client-2',
        },
        {
          contact_name_id: 'contact-keep',
          full_name: 'Shared Contact',
          email: 'shared@example.com',
          client_id: 'client-2',
        },
      ];
    }

    return [];
  }),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamsBasic: vi.fn().mockResolvedValue([
    {
      team_id: 'team-1',
      team_name: 'Dispatch',
    },
  ]),
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic: vi.fn().mockResolvedValue([
    {
      user_id: 'user-1',
      username: 'alex',
      first_name: 'Alex',
      last_name: 'Agent',
      user_type: 'internal',
      is_inactive: false,
      tenant: 'tenant-1',
    },
  ]),
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getTicketById: vi.fn().mockImplementation(async (ticketId: string) => {
    if (ticketId === 'ticket-1') {
      return { ticket_id: 'ticket-1', board_id: 'board-1' };
    }

    if (ticketId === 'ticket-2') {
      return { ticket_id: 'ticket-2', board_id: 'board-2' };
    }

    return null;
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

const getSelectValues = (testId: string): string[] =>
  Array.from((screen.getByTestId(testId) as HTMLSelectElement).options).map((option) => option.value);

describe('InputMappingEditor picker-backed fields', () => {
  it('T166/T181/T182/T183/T184/T185/T186/T187/T188/T189/T190/T308: renders ticket-core picker-backed fields with picker UI in fixed mode so builders can author ticket actions without raw ids', async () => {
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
              picker: {
                kind: 'ticket-status',
                dependencies: ['board_id'],
                allowsDynamicReference: true,
              },
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
    await waitFor(() =>
      expect(getSelectValues('mapping-step-ticket-pickers-status_id-literal-picker')).toEqual([
        '',
        'status-1',
      ])
    );
    expect(
      screen.getByTestId('mapping-step-ticket-pickers-status_id-literal-picker')
    ).toHaveValue('status-1');
  });

  it('T167/T168/T191/T192/T193/T194/T195/T196/T197/T198/T199/T309: picker-backed fields can switch to reference and back to fixed without losing picker UI', async () => {
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

  it('T201/T202/T203/T204/T205/T214/T217/T310/T311: dependent ticket pickers narrow to fixed upstream scope, refresh immediately, and rehydrate valid saved selections', async () => {
    const targetFields = [
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
        name: 'location_id',
        type: 'string',
        picker: {
          kind: 'client-location',
          dependencies: ['client_id'],
          allowsDynamicReference: true,
        },
      },
      {
        name: 'board_id',
        type: 'string',
        picker: { kind: 'board', allowsDynamicReference: true },
      },
      {
        name: 'status_id',
        type: 'string',
        picker: {
          kind: 'ticket-status',
          dependencies: ['board_id'],
          allowsDynamicReference: true,
        },
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
    ];

    const Harness = () => {
      const [value, setValue] = React.useState({
        client_id: 'client-1',
        contact_id: 'contact-1',
        location_id: 'location-1',
        board_id: 'board-1',
        status_id: 'status-1',
        category_id: 'category-1',
        subcategory_id: 'subcategory-1',
      });

      return (
        <InputMappingEditor
          value={value}
          onChange={(nextValue) => setValue(nextValue as typeof value)}
          targetFields={[...targetFields]}
          fieldOptions={[]}
          stepId="step-dependent-pickers"
          positionsHandlers={positionsHandlers}
        />
      );
    };

    await act(async () => {
      render(<Harness />);
    });

    await waitFor(() =>
      expect(getSelectValues('mapping-step-dependent-pickers-contact_id-literal-picker')).toEqual([
        '',
        'contact-1',
        'contact-keep',
      ])
    );
    expect(
      screen.getByTestId('mapping-step-dependent-pickers-contact_id-literal-picker')
    ).toHaveValue('contact-1');
    expect(getSelectValues('mapping-step-dependent-pickers-location_id-literal-picker')).toEqual([
      '',
      'location-1',
    ]);
    expect(getSelectValues('mapping-step-dependent-pickers-category_id-literal-picker')).toEqual([
      '',
      'category-1',
    ]);
    expect(
      screen.getByTestId('mapping-step-dependent-pickers-category_id-literal-picker')
    ).toHaveValue('category-1');
    expect(getSelectValues('mapping-step-dependent-pickers-status_id-literal-picker')).toEqual([
      '',
      'status-1',
    ]);
    expect(
      screen.getByTestId('mapping-step-dependent-pickers-status_id-literal-picker')
    ).toHaveValue('status-1');
    expect(getSelectValues('mapping-step-dependent-pickers-subcategory_id-literal-picker')).toEqual([
      '',
      'subcategory-1',
    ]);
    expect(
      screen.getByTestId('mapping-step-dependent-pickers-subcategory_id-literal-picker')
    ).toHaveValue('subcategory-1');

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-dependent-pickers-client_id-literal-picker'), {
        target: { value: 'client-2' },
      });
    });

    await waitFor(() =>
      expect(getSelectValues('mapping-step-dependent-pickers-contact_id-literal-picker')).toEqual([
        '',
        'contact-2',
        'contact-keep',
      ])
    );
    expect(getSelectValues('mapping-step-dependent-pickers-location_id-literal-picker')).toEqual([
      '',
      'location-2',
    ]);

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-dependent-pickers-board_id-literal-picker'), {
        target: { value: 'board-2' },
      });
    });

    await waitFor(() =>
      expect(getSelectValues('mapping-step-dependent-pickers-status_id-literal-picker')).toEqual([
        '',
        'status-2',
      ])
    );

    await waitFor(() =>
      expect(getSelectValues('mapping-step-dependent-pickers-category_id-literal-picker')).toEqual([
        '',
        'category-2',
      ])
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-dependent-pickers-category_id-literal-picker'), {
        target: { value: 'category-2' },
      });
    });

    await waitFor(() =>
      expect(
        getSelectValues('mapping-step-dependent-pickers-subcategory_id-literal-picker')
      ).toEqual(['', 'subcategory-2'])
    );
  });

  it('T206/T207/T208/T209: dependent pickers show disabled guidance when required fixed scope is missing', async () => {
    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            client_id: '',
            contact_id: '',
            location_id: '',
            board_id: '',
            category_id: '',
            subcategory_id: '',
          }}
          onChange={vi.fn()}
          targetFields={[
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
              name: 'location_id',
              type: 'string',
              picker: {
                kind: 'client-location',
                dependencies: ['client_id'],
                allowsDynamicReference: true,
              },
            },
            {
              name: 'board_id',
              type: 'string',
              picker: { kind: 'board', allowsDynamicReference: true },
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
          ]}
          fieldOptions={[]}
          stepId="step-missing-scope"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(screen.getByTestId('mapping-step-missing-scope-contact_id-literal-picker')).toBeDisabled();
    expect(screen.getByText('Choose a fixed Client first to load contact options.')).toBeVisible();
    expect(screen.getByTestId('mapping-step-missing-scope-location_id-literal-picker')).toBeDisabled();
    expect(screen.getByText('Choose a fixed Client first to load location options.')).toBeVisible();
    expect(screen.getByTestId('mapping-step-missing-scope-category_id-literal-picker')).toBeDisabled();
    expect(screen.getByText('Choose a fixed Board first to load category options.')).toBeVisible();
    expect(screen.getByTestId('mapping-step-missing-scope-subcategory_id-literal-picker')).toBeDisabled();
    expect(screen.getByText('Choose a fixed Board first to load subcategory options.')).toBeVisible();
  });

  it('loads ticket status options from a fixed ticket context when the picker depends on ticket_id', async () => {
    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            ticket_id: 'ticket-1',
            status_id: 'status-1',
          }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'ticket_id',
              type: 'string',
            },
            {
              name: 'status_id',
              type: 'string',
              picker: {
                kind: 'ticket-status',
                dependencies: ['ticket_id'],
                allowsDynamicReference: true,
              },
            },
          ]}
          fieldOptions={[]}
          stepId="step-ticket-status-by-ticket"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    await waitFor(() =>
      expect(getSelectValues('mapping-step-ticket-status-by-ticket-status_id-literal-picker')).toEqual([
        '',
        'status-1',
      ])
    );

    expect(
      screen.getByTestId('mapping-step-ticket-status-by-ticket-status_id-literal-picker')
    ).toHaveValue('status-1');
  });

  it('T210/T211/T212/T213/T218/T219/T312: dynamic upstream references keep dependent fixed pickers disabled while still allowing a switch back to Reference mode', async () => {
    const ClientScopeHarness = () => {
      const [value, setValue] = React.useState({
        client_id: { $expr: 'payload.client.id' },
        contact_id: '',
        location_id: '',
      });

      return (
        <>
          <InputMappingEditor
            value={value}
            onChange={(nextValue) => setValue(nextValue as typeof value)}
            targetFields={[
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
                name: 'location_id',
                type: 'string',
                picker: {
                  kind: 'client-location',
                  dependencies: ['client_id'],
                  allowsDynamicReference: true,
                },
              },
            ]}
            fieldOptions={[{ value: 'payload.ticket.id', label: 'payload.ticket.id' }]}
            stepId="step-dynamic-client-scope"
            positionsHandlers={positionsHandlers}
          />
          <output data-testid="dynamic-client-mapping-value">{JSON.stringify(value)}</output>
        </>
      );
    };

    await act(async () => {
      render(<ClientScopeHarness />);
    });

    expect(screen.getByTestId('mapping-step-dynamic-client-scope-contact_id-literal-picker')).toBeDisabled();
    expect(screen.getByTestId('mapping-step-dynamic-client-scope-location_id-literal-picker')).toBeDisabled();
    expect(screen.getByText('Choose a fixed Client first to load contact options.')).toBeVisible();
    expect(screen.getByText('Choose a fixed Client first to load location options.')).toBeVisible();

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-dynamic-client-scope-contact_id-source-mode'), {
        target: { value: 'reference' },
      });
    });

    expect(screen.getByTestId('dynamic-client-mapping-value').textContent).toContain(
      '"contact_id":{"$expr":""}'
    );

    cleanup();

    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            board_id: { $expr: 'payload.board.id' },
            category_id: '',
          }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'board_id',
              type: 'string',
              picker: { kind: 'board', allowsDynamicReference: true },
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
          ]}
          fieldOptions={[]}
          stepId="step-dynamic-board-scope"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(screen.getByTestId('mapping-step-dynamic-board-scope-category_id-literal-picker')).toBeDisabled();
    expect(screen.getByText('Choose a fixed Board first to load category options.')).toBeVisible();

    cleanup();

    await act(async () => {
      render(
        <InputMappingEditor
          value={{
            board_id: 'board-1',
            category_id: { $expr: 'payload.category.id' },
            subcategory_id: '',
          }}
          onChange={vi.fn()}
          targetFields={[
            {
              name: 'board_id',
              type: 'string',
              picker: { kind: 'board', allowsDynamicReference: true },
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
          ]}
          fieldOptions={[]}
          stepId="step-dynamic-category-scope"
          positionsHandlers={positionsHandlers}
        />
      );
    });

    expect(
      screen.getByTestId('mapping-step-dynamic-category-scope-subcategory_id-literal-picker')
    ).toBeDisabled();
    expect(screen.getByText('Choose a fixed Category first to load subcategory options.')).toBeVisible();
  });

  it('T215: invalid dependent selections clear when an upstream fixed picker value changes scope', async () => {
    const Harness = () => {
      const [value, setValue] = React.useState({
        client_id: 'client-1',
        contact_id: 'contact-1',
      });

      return (
        <InputMappingEditor
          value={value}
          onChange={(nextValue) => setValue(nextValue as typeof value)}
          targetFields={[
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
          ]}
          fieldOptions={[]}
          stepId="step-invalid-dependent-clear"
          positionsHandlers={positionsHandlers}
        />
      );
    };

    await act(async () => {
      render(<Harness />);
    });

    await waitFor(() =>
      expect(screen.getByTestId('mapping-step-invalid-dependent-clear-contact_id-literal-picker')).toHaveValue(
        'contact-1'
      )
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-invalid-dependent-clear-client_id-literal-picker'), {
        target: { value: 'client-2' },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('mapping-step-invalid-dependent-clear-contact_id-literal-picker')).toHaveValue(
        ''
      )
    );
  });

  it('T216: still-valid dependent selections are preserved when upstream fixed scope changes without invalidating them', async () => {
    const Harness = () => {
      const [value, setValue] = React.useState({
        client_id: 'client-1',
        contact_id: 'contact-keep',
      });

      return (
        <InputMappingEditor
          value={value}
          onChange={(nextValue) => setValue(nextValue as typeof value)}
          targetFields={[
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
          ]}
          fieldOptions={[]}
          stepId="step-valid-dependent-preserve"
          positionsHandlers={positionsHandlers}
        />
      );
    };

    await act(async () => {
      render(<Harness />);
    });

    await waitFor(() =>
      expect(screen.getByTestId('mapping-step-valid-dependent-preserve-contact_id-literal-picker')).toHaveValue(
        'contact-keep'
      )
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('mapping-step-valid-dependent-preserve-client_id-literal-picker'), {
        target: { value: 'client-2' },
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('mapping-step-valid-dependent-preserve-contact_id-literal-picker')).toHaveValue(
        'contact-keep'
      )
    );
  });
});
