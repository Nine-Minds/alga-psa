/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React, { useEffect, useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
let QuickAddTicket: typeof import('../QuickAddTicket').QuickAddTicket;

const addTicketMock = vi.fn();
const getTicketFormDataMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock
  })
}));

vi.mock('../../actions/ticketActions', () => ({
  addTicket: (...args: unknown[]) => addTicketMock(...args)
}));

vi.mock('../../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args)
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactsByClient: vi.fn(async () => []),
  getClientLocations: vi.fn(async () => []),
}));

vi.mock('../../actions/ticketResourceActions', () => ({
  addTicketResource: vi.fn(async () => ({ resource_id: 'resource-1' })),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  __esModule: true,
  ClientPicker: ({ onSelect, selectedClientId }: any) => {
    const hasSelected = useRef(false);
    useEffect(() => {
      if (!selectedClientId && !hasSelected.current) {
        hasSelected.current = true;
        onSelect('client-1');
      }
    }, [selectedClientId]);
    return <div data-testid="client-picker" />;
  },
  default: ({ onSelect, selectedClientId }: any) => {
    const hasSelected = useRef(false);
    useEffect(() => {
      if (!selectedClientId && !hasSelected.current) {
        hasSelected.current = true;
        onSelect('client-1');
      }
    }, [selectedClientId]);
    return <div data-testid="client-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: ({ onValueChange }: any) => {
    const hasSelected = useRef(false);
    useEffect(() => {
      if (!hasSelected.current) {
        hasSelected.current = true;
        onValueChange('user-1');
      }
    }, []);
    return <div data-testid="user-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({ onSelect }: any) => {
    const hasSelected = useRef(false);
    useEffect(() => {
      if (!hasSelected.current) {
        hasSelected.current = true;
        onSelect('board-1');
      }
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

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => <div data-testid="tag-picker" />
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'user-1', tenant: 'tenant-1' })),
  getUserAvatarUrlsBatchAction: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: { value?: Date }) => (
    <input data-testid="due-date" value={value ? value.toISOString() : ''} readOnly />
  )
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: () => <input data-testid="due-time" />
}));

describe('QuickAddTicket prefills', () => {
  beforeEach(async () => {
    await vi.resetModules();
    ({ QuickAddTicket } = await import('../QuickAddTicket'));
    pushMock.mockReset();
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

});
