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
  mockGetAllCompanies,
  mockGetAllPriorities,
  mockGetAllUsers,
} = vi.hoisted(() => ({
  mockGetTicketFieldOptions: vi.fn(),
  mockGetCategoriesByBoard: vi.fn(),
  mockCreateInboundTicketDefaults: vi.fn(),
  mockUpdateInboundTicketDefaults: vi.fn(),
  mockGetAllBoards: vi.fn(),
  mockGetAllCompanies: vi.fn(),
  mockGetAllPriorities: vi.fn(),
  mockGetAllUsers: vi.fn(),
}));

vi.mock('../../../components/settings/general/BoardPicker', () => ({
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

vi.mock('../../../components/companies/CompanyPicker', () => ({
  __esModule: true,
  CompanyPicker: ({
    id,
    companies = [],
    selectedCompanyId,
    onSelect,
    placeholder,
  }: any) => (
    <select
      id={id}
      data-testid="company-picker"
      value={selectedCompanyId || ''}
      onChange={(event) => onSelect(event.target.value ? event.target.value : null)}
    >
      <option value="">{placeholder ?? 'Select Company'}</option>
      {companies.map((company: any) => (
        <option key={company.company_id || company.id} value={company.company_id || company.id}>
          {company.company_name || company.name}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../../../components/tickets/CategoryPicker', () => ({
  __esModule: true,
  CategoryPicker: ({ id = 'category-picker', selectedCategories = [], onSelect, placeholder, disabled }: any) => (
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

vi.mock('../../../components/tickets/PrioritySelect', () => ({
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

vi.mock('../../../components/ui/CustomSelect', () => ({
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

vi.mock('../../../components/ui/UserPicker', () => ({
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

vi.mock('../../../lib/actions/email-actions/ticketFieldOptionsActions', () => ({
  __esModule: true,
  getTicketFieldOptions: mockGetTicketFieldOptions,
  getCategoriesByBoard: mockGetCategoriesByBoard,
}));

vi.mock('../../../lib/actions/email-actions/inboundTicketDefaultsActions', () => ({
  __esModule: true,
  createInboundTicketDefaults: mockCreateInboundTicketDefaults,
  updateInboundTicketDefaults: mockUpdateInboundTicketDefaults,
}));

vi.mock('server/src/lib/actions/board-actions/boardActions', () => ({
  __esModule: true,
  getAllBoards: mockGetAllBoards,
}));

vi.mock('server/src/lib/actions/company-actions/companyActions', () => ({
  __esModule: true,
  getAllCompanies: mockGetAllCompanies,
}));

vi.mock('server/src/lib/actions/priorityActions', () => ({
  __esModule: true,
  getAllPriorities: mockGetAllPriorities,
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  __esModule: true,
  getAllUsers: mockGetAllUsers,
}));

import { InboundTicketDefaultsForm } from '../../../components/forms/InboundTicketDefaultsForm';

const sampleFieldOptions = {
  boards: [{ id: 'board-1', name: 'General', is_default: true }],
  statuses: [{ id: 'status-1', name: 'New', is_default: false }],
  priorities: [{ id: 'priority-1', name: 'Medium' }],
  categories: [],
  companies: [{ id: 'company-1', name: 'Umbrella Corp' }],
  users: [],
  locations: [],
};

const sampleBoards = [
  { board_id: 'board-1', board_name: 'General', is_inactive: false },
];

const sampleCompanies = [
  { company_id: 'company-1', company_name: 'Umbrella Corp', is_inactive: false },
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
    mockGetAllCompanies.mockResolvedValue(sampleCompanies);
    mockGetAllPriorities.mockResolvedValue(samplePriorities);
    mockGetAllUsers.mockResolvedValue([]);
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
    const companySelect = screen.getByLabelText('Company *');

    await user.type(shortNameInput, 'catch-all');
    await user.type(displayNameInput, 'Catch All Defaults');
    await user.selectOptions(statusSelect, 'status-1');
    await user.selectOptions(prioritySelect, 'priority-1');
    await user.selectOptions(companySelect, 'company-1');

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
