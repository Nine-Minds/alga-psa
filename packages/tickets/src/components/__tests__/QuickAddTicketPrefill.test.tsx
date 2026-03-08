/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuickAddTicket } from '../QuickAddTicket';

const addTicketMock = vi.fn();
const getTicketFormDataMock = vi.fn();
const getContactsByClientMock = vi.fn();
const getClientLocationsMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/server', () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    next: vi.fn(),
    json: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next-auth/lib/env', () => ({
  setEnvDefaults: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock
  })
}));

vi.mock('../../actions/ticketActions', () => ({
  addTicket: (...args: unknown[]) => addTicketMock(...args)
}));

vi.mock('../../actions/ticketResourceActions', () => ({
  addTicketResource: vi.fn()
}));

vi.mock('../../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args)
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactsByClient: (...args: unknown[]) => getContactsByClientMock(...args),
  getClientLocations: (...args: unknown[]) => getClientLocationsMock(...args)
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: function ClientPickerMock({ onSelect, selectedClientId, onAddNew, clients }: any) {
    useEffect(() => {
      if (!selectedClientId) {
        onSelect('client-1');
      }
    }, []);
    return (
      <div data-testid="client-picker">
        <div data-testid="client-picker-value">{selectedClientId}</div>
        <div data-testid="client-picker-count">{clients.length}</div>
        {onAddNew ? (
          <button type="button" onClick={onAddNew}>
            + Add new client
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({ onAddNew, value, contacts }: any) => (
    <div data-testid="contact-picker">
      <div data-testid="contact-picker-value">{value}</div>
      <div data-testid="contact-picker-count">{contacts.length}</div>
      {onAddNew ? (
        <button type="button" onClick={onAddNew}>
          + Add new contact
        </button>
      ) : null}
    </div>
  )
}));

vi.mock('@alga-psa/clients/components', () => ({
    __esModule: true,
    QuickAddContact: ({ isOpen, selectedClientId, onContactAdded }: any) => {
      if (!isOpen) {
        return null;
      }

      return (
        <div data-testid="quick-add-contact-dialog">
          <div data-testid="quick-add-contact-client">{selectedClientId}</div>
          <button
            type="button"
            onClick={() => onContactAdded({
              contact_name_id: 'contact-new',
              full_name: 'Grace Hopper',
              email: 'grace@example.com',
              client_id: selectedClientId,
              is_inactive: false,
            })}
          >
            Create Contact
          </button>
        </div>
      );
    },
    QuickAddClient: ({ open, onClientAdded, onOpenChange }: any) => {
      if (!open) {
        return null;
      }

      return (
        <div data-testid="quick-add-client-dialog">
          <button
            type="button"
            onClick={() => {
              onClientAdded({
                client_id: 'client-new',
                client_name: 'New Client',
                client_type: 'company',
                is_inactive: false,
              });
              onOpenChange(false);
            }}
          >
            Create Client
          </button>
        </div>
      );
    },
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: function UserPickerMock({ onValueChange }: any) {
    useEffect(() => {
      onValueChange('user-1');
    }, []);
    return <div data-testid="user-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({ onSelect }: any) => {
    useEffect(() => {
      onSelect('board-1');
    }, []);
    return <div data-testid="board-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ onValueChange, options, value }: any) => (
    <select
      data-testid="custom-select"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({ categories: [], boardConfig: { priority_type: 'custom' } }),
  getTicketCategories: vi.fn(),
  getAllBoards: vi.fn()
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn().mockResolvedValue([]),
  getAllPriorities: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
  getUserAvatarUrlsBatchAction: vi.fn()
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => <div data-testid="tag-picker" />
}));

vi.mock('@alga-psa/tags/actions', () => ({
  createTagsForEntity: vi.fn()
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn()
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: { value?: Date }) => (
    <input data-testid="due-date" value={value ? value.toISOString() : ''} readOnly />
  )
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: () => <input data-testid="due-time" />
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false })
}));

describe('QuickAddTicket prefills', () => {
  beforeEach(() => {
    pushMock.mockReset();
    getContactsByClientMock.mockResolvedValue([]);
    getClientLocationsMock.mockResolvedValue([]);
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [{ board_id: 'board-1', board_name: 'Support' }],
      priorities: [{ priority_id: 'priority-1', priority_name: 'High' }],
      clients: [{ client_id: 'client-1', client_name: 'Acme', client_type: 'company' }],
      statuses: [{ status_id: 'status-1', name: 'Open' }],
      selectedClient: { client_id: 'client-1', client_type: 'company' }
    });
    addTicketMock.mockResolvedValue({ ticket_id: 'ticket-1' });
  });

  it('initializes title input from prefilledTitle', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledTitle="Prefilled Title"
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Ticket Title *')).toHaveValue('Prefilled Title');
  });

  it('initializes assigned user from prefilledAssignedTo', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledAssignedTo="user-1"
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByTestId('user-picker')).toBeInTheDocument();
  });

  it('initializes due date from prefilledDueDate', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledDueDate={new Date('2026-02-05T12:00:00.000Z')}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByTestId('due-date')).toHaveValue('2026-02-05T12:00:00.000Z');
  });

  it('navigates to the created ticket when Save + Open is clicked', async () => {
    const onTicketAdded = vi.fn();

    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={onTicketAdded}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), {
      target: { value: 'New ticket from quick add' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save + Open' }));

    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());
    await waitFor(() => expect(onTicketAdded).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith('/msp/tickets/ticket-1');
  });

  it('T006: clicking add new contact opens QuickAddContact dialog', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /\+ add new contact/i }, { timeout: 5000 }));

    expect(screen.getByTestId('quick-add-contact-dialog')).toBeInTheDocument();
  });

  it('T007: QuickAddContact receives the current selected client id', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /\+ add new contact/i }, { timeout: 5000 }));

    expect(screen.getByTestId('quick-add-contact-client')).toHaveTextContent('client-1');
  });

  it('T008: creating a contact adds it locally and auto-selects it', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    await screen.findByRole('button', { name: /\+ add new contact/i }, { timeout: 5000 });
    expect(screen.getByTestId('contact-picker-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: /\+ add new contact/i }));
    fireEvent.click(screen.getByRole('button', { name: /create contact/i }));

    await waitFor(() => expect(screen.queryByTestId('quick-add-contact-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('contact-picker-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('contact-picker-value')).toHaveTextContent('contact-new');
  });

  it('T021: clicking add new client opens QuickAddClient dialog', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /\+ add new client/i }, { timeout: 5000 }));

    expect(screen.getByTestId('quick-add-client-dialog')).toBeInTheDocument();
  });

  it('T022: creating a client adds it locally and auto-selects it', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
      />
    );

    await screen.findByRole('button', { name: /\+ add new client/i }, { timeout: 5000 });
    expect(screen.getByTestId('client-picker-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /\+ add new client/i }));
    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => expect(screen.queryByTestId('quick-add-client-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('client-picker-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('client-picker-value')).toHaveTextContent('client-new');
  });

});
