/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

/**
 * The billing choice on a linked ticket has to survive the click that made the
 * link: the row the component paints optimistically must carry the persisted
 * link_id, or the Wallet toggle flips local state only and the choice is lost
 * on the next load (alga-2026-0002622).
 */

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TaskTicketLinks from '../TaskTicketLinks';
import { TicketIntegrationProvider, type TicketIntegrationContextType } from '../../context/TicketIntegrationContext';

const addTicketLinkActionMock = vi.hoisted(() => vi.fn());
const getTaskTicketLinksActionMock = vi.hoisted(() => vi.fn());
const setTicketLinkBillingActionMock = vi.hoisted(() => vi.fn());

vi.mock('../../actions/projectTaskActions', () => ({
  addTicketLinkAction: (...args: unknown[]) => addTicketLinkActionMock(...args),
  deleteTaskTicketLinkAction: vi.fn(),
  getTaskTicketLinksAction: (...args: unknown[]) => getTaskTicketLinksActionMock(...args),
  setTicketLinkBillingAction: (...args: unknown[]) => setTicketLinkBillingActionMock(...args),
}));

vi.mock('../../actions/projectActions', () => ({
  getProject: vi.fn().mockResolvedValue({ client_id: 'client-1', client_name: 'Acme' }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn().mockResolvedValue([]),
  getAllPriorities: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

// Radix' select is not worth driving in jsdom; the component only needs a way
// to hand it the chosen ticket id.
vi.mock('../TicketSelect', () => ({
  default: ({ onValueChange }: { onValueChange: (value: string) => void }) => (
    <button type="button" onClick={() => onValueChange('ticket-1')}>
      pick-ticket
    </button>
  ),
}));

function createMockTicketIntegration(): TicketIntegrationContextType {
  return {
    getTicketsForList: vi.fn().mockResolvedValue([
      { ticket_id: 'ticket-1', ticket_number: 'TK-1', title: 'Printer down', status_name: 'Open' },
    ]),
    getConsolidatedTicketData: vi.fn().mockResolvedValue({}),
    getTicketCategories: vi.fn().mockResolvedValue([]),
    getAllBoards: vi.fn().mockResolvedValue([]),
    openTicketInDrawer: vi.fn().mockResolvedValue(undefined),
    renderQuickAddTicket: vi.fn().mockReturnValue(null),
    renderCategoryPicker: vi.fn().mockReturnValue(null),
    renderPrioritySelect: vi.fn().mockReturnValue(null),
    deleteTicket: vi.fn(),
  };
}

async function linkTicket(container: HTMLElement) {
  fireEvent.click(screen.getByRole('button', { name: 'Link Ticket' }));
  const pick = await screen.findByRole('button', { name: 'pick-ticket' });
  fireEvent.click(pick);
  const confirm = container.ownerDocument.querySelector('#confirm-link-button') as HTMLButtonElement;
  expect(confirm).toBeTruthy();
  fireEvent.click(confirm);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskTicketLinks billing choice', () => {
  let mockCtx: TicketIntegrationContextType;

  beforeEach(() => {
    mockCtx = createMockTicketIntegration();
    getTaskTicketLinksActionMock.mockResolvedValue([]);
    addTicketLinkActionMock.mockResolvedValue({
      link_id: 'link-db-1',
      task_id: 'task-1',
      ticket_id: 'ticket-1',
      project_id: 'project-1',
      phase_id: 'phase-1',
      bill_under_project: true,
      tenant: 'tenant-1',
      created_at: new Date(),
    });
    setTicketLinkBillingActionMock.mockResolvedValue(undefined);
  });

  it('keeps the persisted link id so the new row can toggle its billing server-side', async () => {
    const { container } = render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks taskId="task-1" phaseId="phase-1" projectId="project-1" initialLinks={[]} users={[]} />
      </TicketIntegrationProvider>
    );

    await linkTicket(container);

    await waitFor(() =>
      expect(addTicketLinkActionMock).toHaveBeenCalledWith('project-1', 'task-1', 'ticket-1', 'phase-1', true)
    );

    const toggle = await waitFor(() => {
      const button = container.ownerDocument.querySelector('#toggle-link-billing-link-db-1-button');
      expect(button).toBeTruthy();
      return button as HTMLButtonElement;
    });

    fireEvent.click(toggle);

    await waitFor(() => expect(setTicketLinkBillingActionMock).toHaveBeenCalledWith('link-db-1', false));
  });

  it('reflects the flag the server stored rather than the dialog state', async () => {
    addTicketLinkActionMock.mockResolvedValue({
      link_id: 'link-db-2',
      task_id: 'task-1',
      ticket_id: 'ticket-1',
      project_id: 'project-1',
      phase_id: 'phase-1',
      bill_under_project: false,
      tenant: 'tenant-1',
      created_at: new Date(),
    });

    const { container } = render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks taskId="task-1" phaseId="phase-1" projectId="project-1" initialLinks={[]} users={[]} />
      </TicketIntegrationProvider>
    );

    await linkTicket(container);

    expect(await screen.findByText('Billed at client level')).toBeInTheDocument();

    const toggle = container.ownerDocument.querySelector('#toggle-link-billing-link-db-2-button') as HTMLButtonElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(setTicketLinkBillingActionMock).toHaveBeenCalledWith('link-db-2', true));
  });
});
