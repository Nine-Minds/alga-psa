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
  mockGetCategoriesByBoard,
  mockCreateInboundTicketDefaults,
  mockUpdateInboundTicketDefaults,
  mockGetAllBoards,
  mockGetAllClients,
  mockGetAllPriorities,
  mockGetAllUsersBasic,
} = vi.hoisted(() => ({
  mockGetTicketFieldOptions: vi.fn(),
  mockGetCategoriesByBoard: vi.fn(),
  mockCreateInboundTicketDefaults: vi.fn(),
  mockUpdateInboundTicketDefaults: vi.fn(),
  mockGetAllBoards: vi.fn(),
  mockGetAllClients: vi.fn(),
  mockGetAllPriorities: vi.fn(),
  mockGetAllUsersBasic: vi.fn(),
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

vi.mock('@alga-psa/clients/components/clients/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: ({
    id,
    clients = [],
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
      {clients.map((client: any) => (
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

vi.mock('@alga-psa/tickets/components/PrioritySelect', () => ({
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
  getCategoriesByBoard: mockGetCategoriesByBoard,
  createInboundTicketDefaults: mockCreateInboundTicketDefaults,
  updateInboundTicketDefaults: mockUpdateInboundTicketDefaults,
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  __esModule: true,
  getAllBoards: mockGetAllBoards,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  __esModule: true,
  getAllClients: mockGetAllClients,
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  __esModule: true,
  getAllPriorities: mockGetAllPriorities,
}));

vi.mock('@alga-psa/users/actions', () => ({
  __esModule: true,
  getAllUsersBasic: mockGetAllUsersBasic,
}));

import { InboundTicketDefaultsForm } from '@alga-psa/integrations/components';

const sampleFieldOptions = {
  boards: [{ id: 'board-1', name: 'General', is_default: true }],
  statuses: [{ id: 'status-1', name: 'New', is_default: false }],
  priorities: [{ id: 'priority-1', name: 'Medium' }],
  categories: [],
  clients: [{ id: 'client-1', name: 'Acme Corp' }],
  users: [],
  locations: [],
};

const sampleBoards = [
  { board_id: 'board-1', board_name: 'General', is_inactive: false },
];

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
    mockGetCategoriesByBoard.mockResolvedValue({ categories: [] });
    mockGetAllBoards.mockResolvedValue(sampleBoards);
    mockGetAllClients.mockResolvedValue(sampleClients);
    mockGetAllPriorities.mockResolvedValue(samplePriorities);
    mockGetAllUsersBasic.mockResolvedValue([]);
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
    const statusSelect = screen.getByLabelText('Status *');
    const prioritySelect = screen.getByLabelText('Priority *');
    const clientSelect = screen.getByLabelText('Client *');

    await user.type(shortNameInput, 'catch-all');
    await user.type(displayNameInput, 'Catch All Defaults');
    await user.selectOptions(statusSelect, 'status-1');
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
});
