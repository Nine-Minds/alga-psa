/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import { renderWithProviders } from '../../utils/testWrapper';

const {
  mockGetTicketFieldOptions,
  mockGetAvailableStatuses,
  mockGetCategoriesByBoard,
  mockCreateInboundTicketDefaults,
  mockUpdateInboundTicketDefaults,
  mockGetAllPriorities,
  mockGetPrioritiesByBoardType,
  mockGetAllUsersBasic,
  pickerClients,
  mockGetUserAvatarUrlsBatchAction,
} = vi.hoisted(() => ({
  mockGetTicketFieldOptions: vi.fn(),
  mockGetAvailableStatuses: vi.fn(),
  mockGetCategoriesByBoard: vi.fn(),
  mockCreateInboundTicketDefaults: vi.fn(),
  mockUpdateInboundTicketDefaults: vi.fn(),
  mockGetAllPriorities: vi.fn(),
  mockGetPrioritiesByBoardType: vi.fn(),
  mockGetAllUsersBasic: vi.fn(),
  // Options the mocked ClientPicker offers; the real picker searches on the server.
  pickerClients: { current: [] as any[] },
  mockGetUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({
    id,
    boards = [],
    selectedBoardId,
    onSelect,
    placeholder,
  }: any) => (
    <select
      id={id}
      data-testid="board-picker"
      value={selectedBoardId || ''}
      onChange={(event) => onSelect(event.target.value || null)}
    >
      <option value="">{placeholder ?? 'Select Board'}</option>
      {boards.map((board: any) => (
        <option key={board.board_id || board.id} value={board.board_id || board.id}>
          {board.board_name || board.name}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: ({
    id,
    selectedClientId,
    onSelect,
    placeholder,
  }: any) => (
    <select
      id={id}
      data-testid="client-picker"
      value={selectedClientId || ''}
      onChange={(event) => onSelect(event.target.value ? event.target.value : null)}
    >
      <option value="">{placeholder ?? 'Select Client'}</option>
      {pickerClients.current.map((client: any) => (
        <option key={client.client_id || client.id} value={client.client_id || client.id}>
          {client.client_name || client.name}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/tickets/components/CategoryPicker', () => ({
  __esModule: true,
  default: ({ id = 'category-picker', selectedCategories = [], onSelect, placeholder, disabled }: any) => (
    <select
      id={id}
      data-testid="category-picker"
      value={selectedCategories[0] || ''}
      onChange={(event) => onSelect(event.target.value ? [event.target.value] : [])}
      placeholder={placeholder}
      disabled={disabled}
    >
      <option value="">{placeholder ?? 'Select category'}</option>
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components', () => ({
  __esModule: true,
  PrioritySelect: ({
    id,
    options = [],
    value,
    onValueChange,
    placeholder,
  }: any) => (
    <select
      id={id}
      data-testid="priority-select"
      value={value || ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">{placeholder ?? 'Select priority'}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    options = [],
    value,
    onValueChange,
    placeholder,
    disabled,
  }: any) => (
    <select
      id={id}
      data-testid={`${id}-select`}
      value={value || ''}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder ?? 'Select option'}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: ({ id, value, onValueChange, placeholder, users = [], disabled }: any) => (
    <select
      id={id}
      data-testid="user-picker"
      value={value || ''}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    >
      <option value="">{placeholder ?? 'Select user'}</option>
      {users.map((user: any) => (
        <option key={user.user_id || user.id} value={user.user_id || user.id}>
          {user.full_name || user.display_name || user.username || 'User'}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  __esModule: true,
  getTicketFieldOptions: mockGetTicketFieldOptions,
  getAvailableStatuses: mockGetAvailableStatuses,
  getCategoriesByBoard: mockGetCategoriesByBoard,
  createInboundTicketDefaults: mockCreateInboundTicketDefaults,
  updateInboundTicketDefaults: mockUpdateInboundTicketDefaults,
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  __esModule: true,
  getAllPriorities: mockGetAllPriorities,
  getPrioritiesByBoardType: mockGetPrioritiesByBoardType,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  __esModule: true,
  getAllUsersBasic: mockGetAllUsersBasic,
  getUserAvatarUrlsBatchAction: mockGetUserAvatarUrlsBatchAction,
}));

import { InboundTicketDefaultsForm } from '../../../../../packages/integrations/src/components/email/forms/InboundTicketDefaultsForm';

const sampleFieldOptions = {
  boards: [
    { id: 'board-1', name: 'General', is_default: true },
    { id: 'board-2', name: 'Projects', is_default: false },
  ],
  statuses: [{ id: 'legacy-status', name: 'Legacy', is_default: false }],
  priorities: [{ id: 'priority-1', name: 'Medium' }],
  categories: [],
  clients: [{ id: 'client-1', name: 'Acme Corp' }],
  users: [],
  locations: [],
};

const sampleClients = [
  { client_id: 'client-1', client_name: 'Acme Corp', is_inactive: false },
];

const samplePriorities = [
  { priority_id: 'priority-1', priority_name: 'Medium', color: '#cccccc' },
];

describe('InboundTicketDefaultsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetTicketFieldOptions.mockResolvedValue({ options: sampleFieldOptions });
    mockGetAvailableStatuses.mockImplementation(async (boardId: string | null) => {
      if (boardId === 'board-1') {
        return {
          statuses: [{ id: 'status-1', name: 'New', is_default: true }],
        };
      }

      if (boardId === 'board-2') {
        return {
          statuses: [{ id: 'status-2', name: 'Escalated', is_default: false }],
        };
      }

      return { statuses: [] };
    });
    mockGetCategoriesByBoard.mockResolvedValue({ categories: [] });
    pickerClients.current = sampleClients;
    mockGetAllPriorities.mockResolvedValue(samplePriorities);
    mockGetPrioritiesByBoardType.mockResolvedValue(samplePriorities);
    mockGetAllUsersBasic.mockResolvedValue([]);
    mockGetUserAvatarUrlsBatchAction.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('prevents submission when board is not selected', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <InboundTicketDefaultsForm
        defaults={null}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());

    const shortNameInput = await screen.findByPlaceholderText('email-general');
    const displayNameInput = screen.getByPlaceholderText('General Email Support');
    const prioritySelect = screen.getByLabelText('Priority *');
    const clientSelect = screen.getByLabelText('Client *');

    await user.type(shortNameInput, 'catch-all');
    await user.type(displayNameInput, 'Catch All Defaults');
    await user.selectOptions(prioritySelect, 'priority-1');
    await user.selectOptions(clientSelect, 'client-1');

    await user.click(screen.getByRole('button', { name: 'Create Defaults' }));

    await waitFor(() => {
      expect(screen.getByText('Board is required')).toBeInTheDocument();
    });

    expect(mockCreateInboundTicketDefaults).not.toHaveBeenCalled();
  });

  it('prevents submission when company is not selected', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <InboundTicketDefaultsForm
        defaults={null}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());

    const shortNameInput = await screen.findByPlaceholderText('email-general');
    const displayNameInput = screen.getByPlaceholderText('General Email Support');
    const boardSelect = screen.getByLabelText('Board *');
    const statusSelect = screen.getByLabelText('Status *');
    const prioritySelect = screen.getByLabelText('Priority *');

    await user.type(shortNameInput, 'catch-all');
    await user.type(displayNameInput, 'Catch All Defaults');
    await user.selectOptions(boardSelect, 'board-1');
    await user.selectOptions(statusSelect, 'status-1');
    await user.selectOptions(prioritySelect, 'priority-1');

    await user.click(screen.getByRole('button', { name: 'Create Defaults' }));

    await waitFor(() => {
      expect(screen.getByText('Company is required')).toBeInTheDocument();
    });

    expect(mockCreateInboundTicketDefaults).not.toHaveBeenCalled();
  });

  it('T034: only loads statuses for the selected board and clears stale status selections when the board changes', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <InboundTicketDefaultsForm
        defaults={null}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());

    const boardSelect = await screen.findByLabelText('Board *');
    const statusSelect = screen.getByLabelText('Status *') as HTMLSelectElement;

    expect(statusSelect).toBeDisabled();

    await user.selectOptions(boardSelect, 'board-1');

    await waitFor(() => {
      expect(mockGetAvailableStatuses).toHaveBeenCalledWith('board-1');
      expect(statusSelect).not.toBeDisabled();
      expect(screen.getByRole('option', { name: 'New (Default)' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('option', { name: 'Escalated' })).not.toBeInTheDocument();

    await user.selectOptions(statusSelect, 'status-1');
    expect(statusSelect.value).toBe('status-1');

    await user.selectOptions(boardSelect, 'board-2');

    await waitFor(() => {
      expect(mockGetAvailableStatuses).toHaveBeenCalledWith('board-2');
      expect(statusSelect.value).toBe('');
      expect(screen.getByRole('option', { name: 'Escalated' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('option', { name: 'New (Default)' })).not.toBeInTheDocument();
  });

  /**
   * ITIL remediation (ee/plans/2026-11-21-itil-remediation), commit group `email-hotfix`.
   * The priority select offers the selected board's family only, because inbound email creates
   * every ticket on that board with the priority stored here.
   */
  const itilPriorities = [
    { priority_id: 'itil-3', priority_name: 'P3 - Medium', color: '#F59E0B', is_from_itil_standard: true, itil_priority_level: 3 },
    { priority_id: 'itil-1', priority_name: 'P1 - Critical', color: '#DC2626', is_from_itil_standard: true, itil_priority_level: 1 },
  ];

  function withTwoKindsOfBoard() {
    mockGetTicketFieldOptions.mockResolvedValue({
      options: {
        ...sampleFieldOptions,
        boards: [
          { id: 'board-1', name: 'General', is_default: true },
          { id: 'board-itil', name: 'ITIL Service Desk', is_default: false },
          { id: 'board-2', name: 'Projects', is_default: false },
        ],
      },
    });
    mockGetAllPriorities.mockResolvedValue([...samplePriorities, ...itilPriorities]);
    mockGetPrioritiesByBoardType.mockImplementation(async (boardId: string) =>
      boardId === 'board-itil' ? itilPriorities : samplePriorities
    );
    mockGetAvailableStatuses.mockResolvedValue({ statuses: [{ id: 'status-1', name: 'New', is_default: true }] });
  }

  it('T032: offers only the priorities the selected board uses', async () => {
    const user = userEvent.setup();
    withTwoKindsOfBoard();

    renderWithProviders(
      <InboundTicketDefaultsForm defaults={null} onSuccess={vi.fn()} onCancel={vi.fn()} />
    );

    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());
    const boardSelect = await screen.findByLabelText('Board *');

    await user.selectOptions(boardSelect, 'board-itil');
    await waitFor(() => {
      expect(mockGetPrioritiesByBoardType).toHaveBeenCalledWith('board-itil', 'ticket');
      expect(screen.getByRole('option', { name: 'P1 - Critical' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: 'Medium' })).not.toBeInTheDocument();

    await user.selectOptions(boardSelect, 'board-1');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Medium' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: 'P1 - Critical' })).not.toBeInTheDocument();
  });

  it('T033: a board change clears a priority the new board does not offer and keeps one it does', async () => {
    const user = userEvent.setup();
    withTwoKindsOfBoard();

    renderWithProviders(
      <InboundTicketDefaultsForm defaults={null} onSuccess={vi.fn()} onCancel={vi.fn()} />
    );

    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());
    const boardSelect = await screen.findByLabelText('Board *');
    const prioritySelect = screen.getByLabelText('Priority *') as HTMLSelectElement;

    await user.selectOptions(boardSelect, 'board-1');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Medium' })).toBeInTheDocument());
    await user.selectOptions(prioritySelect, 'priority-1');
    expect(prioritySelect.value).toBe('priority-1');

    // Same kind: the selection survives.
    await user.selectOptions(boardSelect, 'board-2');
    await waitFor(() => expect(mockGetPrioritiesByBoardType).toHaveBeenCalledWith('board-2', 'ticket'));
    expect(prioritySelect.value).toBe('priority-1');

    // The other kind: the selection is cleared rather than saved against the new board.
    await user.selectOptions(boardSelect, 'board-itil');
    await waitFor(() => expect(prioritySelect.value).toBe(''));
    expect(screen.queryByText(/not one this board offers/)).not.toBeInTheDocument();
  });

  it('T037: a stored priority the board does not offer is kept and warned about, a fitting one is not', async () => {
    const user = userEvent.setup();
    withTwoKindsOfBoard();
    mockUpdateInboundTicketDefaults.mockResolvedValue({ defaults: { id: 'defaults-1' } });

    const storedOnItilBoard = {
      id: 'defaults-1',
      tenant: 'tenant-1',
      short_name: 'catch-all',
      display_name: 'Catch All Defaults',
      board_id: 'board-itil',
      status_id: 'status-1',
      priority_id: 'priority-1',
      client_id: 'client-1',
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as any;

    const { unmount } = renderWithProviders(
      <InboundTicketDefaultsForm defaults={storedOnItilBoard} onSuccess={vi.fn()} onCancel={vi.fn()} />
    );

    const warning = await screen.findByText(/not one this board offers/);
    expect(warning).toBeInTheDocument();
    expect(warning.id).toBe('priority-board-mismatch-warning');

    // The stored value is kept, not silently swapped: a save still carries it, and the server
    // refuses it (the save-side check), so the admin has to choose rather than be corrected.
    await user.click(screen.getByRole('button', { name: 'Update Defaults' }));
    await waitFor(() => expect(mockUpdateInboundTicketDefaults).toHaveBeenCalled());
    expect(mockUpdateInboundTicketDefaults.mock.calls[0][1]).toMatchObject({
      board_id: 'board-itil',
      priority_id: 'priority-1',
    });

    unmount();
    cleanup();

    renderWithProviders(
      <InboundTicketDefaultsForm
        defaults={{ ...storedOnItilBoard, priority_id: 'itil-3' }}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Priority *') as HTMLSelectElement).value).toBe('itil-3')
    );
    expect(screen.queryByText(/not one this board offers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
  });

  it('T037: a stored priority that no longer exists is reported as missing', async () => {
    withTwoKindsOfBoard();

    renderWithProviders(
      <InboundTicketDefaultsForm
        defaults={{
          id: 'defaults-2',
          tenant: 'tenant-1',
          short_name: 'catch-all',
          display_name: 'Catch All Defaults',
          board_id: 'board-itil',
          status_id: 'status-1',
          priority_id: 'deleted-priority',
          client_id: 'client-1',
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        } as any}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  });

  it('submits location_id as null (not undefined) after the client changes so a stale location is cleared', async () => {
    const user = userEvent.setup();

    mockGetTicketFieldOptions.mockResolvedValue({
      options: {
        ...sampleFieldOptions,
        clients: [
          { id: 'client-1', name: 'Acme Corp' },
          { id: 'client-2', name: 'Unmatched senders' },
        ],
        locations: [{ id: 'loc-1', name: 'Acme HQ', client_id: 'client-1' }],
      },
    });
    pickerClients.current = [
      ...sampleClients,
      { client_id: 'client-2', client_name: 'Unmatched senders', is_inactive: false },
    ];
    mockUpdateInboundTicketDefaults.mockResolvedValue({
      defaults: { id: 'defaults-1', client_id: 'client-2', location_id: null },
    });

    renderWithProviders(
      <InboundTicketDefaultsForm
        defaults={{
          id: 'defaults-1',
          tenant: 'tenant-1',
          short_name: 'catch-all',
          display_name: 'Catch All Defaults',
          board_id: 'board-1',
          status_id: 'status-1',
          priority_id: 'priority-1',
          client_id: 'client-1',
          location_id: 'loc-1',
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        } as any}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());

    const locationSelect = (await screen.findByTestId('location_id-select')) as HTMLSelectElement;
    await waitFor(() => expect(locationSelect.value).toBe('loc-1'));

    await user.selectOptions(screen.getByTestId('client-picker'), 'client-2');
    expect(locationSelect.value).toBe('');

    await waitFor(() => expect(screen.getByLabelText('Status *')).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Update Defaults' }));

    await waitFor(() => expect(mockUpdateInboundTicketDefaults).toHaveBeenCalled());
    const [, payload] = mockUpdateInboundTicketDefaults.mock.calls[0];
    expect(payload.client_id).toBe('client-2');
    expect(payload).toHaveProperty('location_id', null);
  });
});
