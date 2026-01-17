/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import { renderWithProviders } from '../../utils/testWrapper';

// Action mocks hoisted for stable references
const {
  mockGetInboundTicketDefaults,
  mockCreateInboundTicketDefaults,
  mockGetTicketFieldOptions,
  mockGetAllBoards,
  mockGetAllClients,
  mockGetAllPriorities,
  mockGetAllUsers,
} = vi.hoisted(() => ({
  mockGetInboundTicketDefaults: vi.fn(),
  mockCreateInboundTicketDefaults: vi.fn(),
  mockGetTicketFieldOptions: vi.fn(),
  mockGetAllBoards: vi.fn(),
  mockGetAllClients: vi.fn(),
  mockGetAllPriorities: vi.fn(),
  mockGetAllUsers: vi.fn(),
}));

// Mock UI subcomponents used by the form for predictable interactions
vi.mock('../../../components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({ id, boards = [], selectedBoardId, onSelect, placeholder }: any) => (
    <select
      id={id}
      aria-label="Board *"
      value={selectedBoardId || ''}
      data-testid="board-picker"
      onChange={(e) => onSelect(e.target.value || null)}
    >
      <option value="">{placeholder ?? 'Select Board'}</option>
      {boards.map((b: any) => (
        <option key={b.board_id || b.id} value={b.board_id || b.id}>
          {b.board_name || b.name}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../../../components/clients/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: ({ id, clients = [], selectedClientId, onSelect, placeholder }: any) => (
    <select
      id={id}
      aria-label="Client"
      value={selectedClientId || ''}
      data-testid="client-picker"
      onChange={(e) => onSelect(e.target.value ? e.target.value : '')}
    >
      <option value="">{placeholder ?? 'Select Client'}</option>
      {clients.map((c: any) => (
        <option key={c.client_id || c.id} value={c.client_id || c.id}>
          {c.client_name || c.name}
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
      aria-label="Category"
      value={selectedCategories[0] || ''}
      data-testid="category-picker"
      onChange={(e) => onSelect(e.target.value ? [e.target.value] : [])}
      placeholder={placeholder}
      disabled={disabled}
    >
      <option value="">{placeholder ?? 'Select category'}</option>
    </select>
  ),
}));

vi.mock('@alga-psa/tickets/components/PrioritySelect', () => ({
  __esModule: true,
  PrioritySelect: ({ id, options = [], value, onValueChange, placeholder }: any) => (
    <select
      id={id}
      aria-label="Priority *"
      value={value || ''}
      data-testid="priority-select"
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">{placeholder ?? 'Select priority'}</option>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {typeof o.label === 'string' ? o.label : o.value}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options = [], value, onValueChange, placeholder }: any) => (
    <select
      id={id}
      value={value || ''}
      data-testid={id}
      onChange={(e) => onValueChange(e.target.value || null)}
    >
      <option value="">{placeholder ?? 'Select option'}</option>
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value}>
          {opt.label || opt.value}
        </option>
      ))}
    </select>
  ),
}));

// Mock server actions used by Manager and Form
vi.mock('../../../lib/actions/email-actions/inboundTicketDefaultsActions', () => ({
  __esModule: true,
  getInboundTicketDefaults: mockGetInboundTicketDefaults,
  createInboundTicketDefaults: mockCreateInboundTicketDefaults,
  updateInboundTicketDefaults: vi.fn(),
  deleteInboundTicketDefaults: vi.fn(),
}));

vi.mock('../../../lib/actions/email-actions/ticketFieldOptionsActions', () => ({
  __esModule: true,
  getTicketFieldOptions: mockGetTicketFieldOptions,
  getCategoriesByBoard: vi.fn().mockResolvedValue({ categories: [] }),
}));

vi.mock('server/src/lib/actions/board-actions/boardActions', () => ({
  __esModule: true,
  getAllBoards: mockGetAllBoards,
}));

vi.mock('server/src/lib/actions/client-actions/clientActions', () => ({
  __esModule: true,
  getAllClients: mockGetAllClients,
}));

vi.mock('server/src/lib/actions/priorityActions', () => ({
  __esModule: true,
  getAllPriorities: mockGetAllPriorities,
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  __esModule: true,
  getAllUsers: mockGetAllUsers,
}));

import { InboundTicketDefaultsManager } from '../../../components/admin/InboundTicketDefaultsManager';

const sampleFieldOptions = {
  boards: [{ id: 'board-1', name: 'General', is_default: true }],
  statuses: [{ id: 'status-1', name: 'New' }],
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

describe('InboundTicketDefaultsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetInboundTicketDefaults.mockResolvedValue({ defaults: [] });
    mockGetTicketFieldOptions.mockResolvedValue({ options: sampleFieldOptions });
    mockGetAllBoards.mockResolvedValue(sampleBoards);
    mockGetAllClients.mockResolvedValue(sampleClients);
    mockGetAllPriorities.mockResolvedValue(samplePriorities);
    mockGetAllUsers.mockResolvedValue([]);
    mockCreateInboundTicketDefaults.mockResolvedValue({
      defaults: {
        id: 'new-1',
        short_name: 'catch-all',
        display_name: 'Catch All Defaults',
        description: '',
        is_active: true,
        board_id: 'board-1',
        status_id: 'status-1',
        priority_id: 'priority-1',
        client_id: 'client-1',
        category_id: '',
        subcategory_id: '',
        location_id: '',
        entered_by: null,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not display "Company is required" when a client is selected and form submits', async () => {
    const user = userEvent.setup();

    renderWithProviders(<InboundTicketDefaultsManager onDefaultsChange={vi.fn()} />);

    // Wait for initial loads
    await waitFor(() => expect(mockGetInboundTicketDefaults).toHaveBeenCalled());
    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());

    // Open the form
    await user.click(screen.getByRole('button', { name: /add defaults/i }));

    // Fill required fields
    const shortName = await screen.findByPlaceholderText('email-general');
    const displayName = screen.getByPlaceholderText('General Email Support');
    const boardSelect = screen.getByLabelText('Board *');
    const statusSelect = screen.getByLabelText('Status *');
    const prioritySelect = screen.getByLabelText('Priority *');
    const clientSelect = screen.getByLabelText('Client');

    await user.type(shortName, 'catch-all');
    await user.type(displayName, 'Catch All Defaults');
    await user.selectOptions(boardSelect, 'board-1');
    await user.selectOptions(statusSelect, 'status-1');
    await user.selectOptions(prioritySelect, 'priority-1');
    await user.selectOptions(clientSelect, 'client-1');

    await user.click(screen.getByRole('button', { name: /create defaults/i }));

    // Ensure no stale company-required validation appears
    await waitFor(() => {
      expect(screen.queryByText('Company is required')).not.toBeInTheDocument();
    });

    // And creation was attempted with selected client
    await waitFor(() => expect(mockCreateInboundTicketDefaults).toHaveBeenCalled());
    const payload = mockCreateInboundTicketDefaults.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ client_id: 'client-1' });
  });

  it('displays "Company is required" when client is not selected', async () => {
    const user = userEvent.setup();

    renderWithProviders(<InboundTicketDefaultsManager onDefaultsChange={vi.fn()} />);

    await waitFor(() => expect(mockGetInboundTicketDefaults).toHaveBeenCalled());
    await waitFor(() => expect(mockGetTicketFieldOptions).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /add defaults/i }));

    const shortName = await screen.findByPlaceholderText('email-general');
    const displayName = screen.getByPlaceholderText('General Email Support');
    const boardSelect = screen.getByLabelText('Board *');
    const statusSelect = screen.getByLabelText('Status *');
    const prioritySelect = screen.getByLabelText('Priority *');
    // Intentionally do not select client

    await user.type(shortName, 'catch-all');
    await user.type(displayName, 'Catch All Defaults');
    await user.selectOptions(boardSelect, 'board-1');
    await user.selectOptions(statusSelect, 'status-1');
    await user.selectOptions(prioritySelect, 'priority-1');

    await user.click(screen.getByRole('button', { name: /create defaults/i }));

    await waitFor(() => {
      expect(screen.getByText('Company is required')).toBeInTheDocument();
    });

    expect(mockCreateInboundTicketDefaults).not.toHaveBeenCalled();
  });
});
