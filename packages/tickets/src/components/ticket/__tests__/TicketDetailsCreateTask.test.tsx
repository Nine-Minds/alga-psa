/* @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TicketDetails from '../TicketDetails';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } })
}));

vi.mock('@alga-psa/core', () => ({
  utcToLocal: (value: string) => new Date(value),
  formatDateTime: () => 'formatted',
  getUserTimeZone: () => 'UTC'
}));

vi.mock('@alga-psa/tags/context', () => ({
  useTags: () => ({ tags: [] })
}));

vi.mock('./TicketInfo', () => ({ default: () => <div data-testid="ticket-info" /> }));
vi.mock('./TicketProperties', () => ({ default: () => <div data-testid="ticket-properties" /> }));
vi.mock('./TicketDocumentsSection', () => ({ default: () => <div data-testid="ticket-documents" /> }));
vi.mock('./TicketConversation', () => ({ default: () => <div data-testid="ticket-conversation" /> }));
vi.mock('./AgentScheduleDrawer', () => ({ default: () => <div data-testid="agent-schedule" /> }));
vi.mock('../ResponseStateBadge', () => ({ ResponseStateBadge: () => <div data-testid="response-state" /> }));

vi.mock('../../actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: vi.fn().mockResolvedValue({ dateTimeFormat: 'MMM d, yyyy h:mm a' })
}));

vi.mock('@alga-psa/tags/actions', () => ({
  findTagsByEntityId: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
  getCurrentUser: vi.fn().mockResolvedValue(null)
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  findBoardById: vi.fn().mockResolvedValue(null),
  getAllBoards: vi.fn().mockResolvedValue([]),
  findCommentsByTicketId: vi.fn().mockResolvedValue([]),
  deleteComment: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  findCommentById: vi.fn(),
  getTicketStatuses: vi.fn().mockResolvedValue([]),
  getAllPriorities: vi.fn().mockResolvedValue([]),
  addTicketResource: vi.fn(),
  getTicketResources: vi.fn().mockResolvedValue([]),
  removeTicketResource: vi.fn(),
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({ categories: [], boardConfig: { priority_type: 'custom' } })
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getDocumentByTicketId: vi.fn().mockResolvedValue([])
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactByContactNameId: vi.fn().mockResolvedValue(null),
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientById: vi.fn().mockResolvedValue(null),
  getAllClients: vi.fn().mockResolvedValue([])
}));

vi.mock('../../actions/optimizedTicketActions', () => ({
  updateTicketWithCache: vi.fn()
}));

vi.mock('../../actions/ticketActions', () => ({
  updateTicket: vi.fn()
}));

vi.mock('../../actions/ticketBundleActions', () => ({
  addChildrenToBundleAction: vi.fn(),
  findTicketByNumberAction: vi.fn(),
  promoteBundleMasterAction: vi.fn(),
  removeChildFromBundleAction: vi.fn(),
  unbundleMasterTicketAction: vi.fn(),
  updateBundleSettingsAction: vi.fn(),
  searchEligibleChildTicketsAction: vi.fn()
}));

describe('TicketDetails renderCreateProjectTask', () => {
  const baseTicket = {
    ticket_id: 'ticket-1',
    ticket_number: 'T-001',
    title: 'Test Ticket',
    tenant: 'tenant-1',
    board_id: 'board-1',
    client_id: 'client-1',
    contact_name_id: null,
    status_id: 'status-1',
    category_id: null,
    subcategory_id: null,
    entered_by: 'user-1',
    updated_by: null,
    closed_by: null,
    assigned_to: null,
    entered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    closed_at: null,
    url: null,
    attributes: {}
  };

  it('renders renderCreateProjectTask button in header', () => {
    render(
      <TicketDetails
        initialTicket={baseTicket as any}
        renderCreateProjectTask={() => <button>Create Task</button>}
      />
    );

    expect(screen.getByRole('button', { name: 'Create Task' })).toBeInTheDocument();
  });

  it('does not render create task button when renderCreateProjectTask is missing', () => {
    render(<TicketDetails initialTicket={baseTicket as any} />);

    expect(screen.queryByRole('button', { name: 'Create Task' })).toBeNull();
  });
});
