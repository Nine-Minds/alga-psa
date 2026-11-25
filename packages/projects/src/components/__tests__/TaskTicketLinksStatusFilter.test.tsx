/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import TaskTicketLinks from '../TaskTicketLinks';
import { TicketIntegrationProvider, type TicketIntegrationContextType } from '../../context/TicketIntegrationContext';

vi.mock('../../actions/projectTaskActions', () => ({
  addTicketLinkAction: vi.fn(),
  deleteTaskTicketLinkAction: vi.fn(),
  getTaskTicketLinksAction: vi.fn().mockResolvedValue([]),
  setTicketLinkBillingAction: vi.fn(),
}));
vi.mock('../../actions/projectActions', () => ({ getProject: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn().mockResolvedValue([
    { status_id: 'resolved-a', name: 'Resolved', board_id: 'board-a' },
    { status_id: 'resolved-b', name: 'Resolved', board_id: 'board-b' },
    { status_id: 'pending-a', name: 'Pending Deployment', board_id: 'board-a' },
  ]),
  getAllPriorities: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/ui', () => ({ useDrawer: () => ({ openDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));

interface SelectProps {
  options: { value: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
}

// Use native controls to exercise the dialog's filter behavior independently
// of Radix's portal and pointer handling.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ options, value, onValueChange, placeholder }: SelectProps) => (
    <select aria-label={placeholder} value={value} onChange={e => onValueChange(e.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  BoardPicker: ({ selectedBoardId, onSelect }: { selectedBoardId: string; onSelect: (value: string) => void }) => (
    <select aria-label="Board" value={selectedBoardId} onChange={e => onSelect(e.target.value)}>
      <option value="">All boards</option>
      <option value="board-a">Board A</option>
      <option value="board-b">Board B</option>
    </select>
  ),
}));
vi.mock('../TicketSelect', () => ({
  default: ({ options }: SelectProps) => (
    <ul aria-label="Matching tickets">
      {options.map(option => <li key={option.value}>{option.label}</li>)}
    </ul>
  ),
}));

afterEach(cleanup);

async function openDialog() {
  const context: TicketIntegrationContextType = {
    getTicketsForList: vi.fn().mockResolvedValue([
      { ticket_id: 'ticket-1', ticket_number: 'TK-1', title: 'First resolved', status_id: 'resolved-a', board_id: 'board-a' },
      { ticket_id: 'ticket-2', ticket_number: 'TK-2', title: 'Second resolved', status_id: 'resolved-b', board_id: 'board-b' },
      { ticket_id: 'ticket-3', ticket_number: 'TK-3', title: 'Deploy fix', status_id: 'pending-a', board_id: 'board-a' },
    ]),
    getConsolidatedTicketData: vi.fn(),
    getTicketCategories: vi.fn().mockResolvedValue([]),
    getAllBoards: vi.fn().mockResolvedValue([]),
    openTicketInDrawer: vi.fn(),
    renderQuickAddTicket: vi.fn().mockReturnValue(null),
    renderCategoryPicker: vi.fn().mockReturnValue(null),
    renderPrioritySelect: vi.fn().mockReturnValue(null),
    deleteTicket: vi.fn(),
  };
  render(
    <TicketIntegrationProvider value={context}>
      <TaskTicketLinks phaseId="phase-1" projectId="project-1" users={[]} />
    </TicketIntegrationProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Link Ticket' }));
  await screen.findByRole('option', { name: 'Pending Deployment' });
  await screen.findByText('TK-3 - Deploy fix');
  return screen.getByRole('combobox', { name: 'All Statuses' });
}

describe('TaskTicketLinks status filter', () => {
  it('shows each status name once and matches all its board-specific IDs', async () => {
    const statusSelect = await openDialog();
    const resolved = within(statusSelect).getByRole('option', { name: 'Resolved' }) as HTMLOptionElement;
    expect(within(statusSelect).getAllByRole('option')).toHaveLength(3);
    fireEvent.change(statusSelect, { target: { value: resolved.value } });

    const tickets = within(screen.getByRole('list', { name: 'Matching tickets' }));
    expect(tickets.getByText('TK-1 - First resolved')).toBeInTheDocument();
    expect(tickets.getByText('TK-2 - Second resolved')).toBeInTheDocument();
    expect(tickets.queryByText('TK-3 - Deploy fix')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Board' }), { target: { value: 'board-b' } });
    expect(statusSelect).toHaveValue(resolved.value);
    expect(within(statusSelect).queryByRole('option', { name: 'Pending Deployment' })).not.toBeInTheDocument();
    expect(tickets.queryByText('TK-1 - First resolved')).not.toBeInTheDocument();
    expect(tickets.getByText('TK-2 - Second resolved')).toBeInTheDocument();
  });

  it('resets a status unavailable on the selected board and restores all statuses when the board is cleared', async () => {
    const statusSelect = await openDialog();
    const pending = within(statusSelect).getByRole('option', { name: 'Pending Deployment' }) as HTMLOptionElement;
    fireEvent.change(statusSelect, { target: { value: pending.value } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Board' }), { target: { value: 'board-b' } });

    expect(statusSelect).toHaveValue('all');
    expect(screen.getByText('TK-2 - Second resolved')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Board' }), { target: { value: '' } });
    expect(within(statusSelect).getByRole('option', { name: 'Pending Deployment' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Matching tickets' })).getAllByRole('listitem')).toHaveLength(3);
  });
});
