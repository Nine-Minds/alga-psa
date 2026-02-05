/* @vitest-environment jsdom */

import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuickAddTicket } from '../QuickAddTicket';

const addTicketMock = vi.fn();
const getTicketFormDataMock = vi.fn();

vi.mock('../actions/ticketActions', () => ({
  addTicket: (...args: unknown[]) => addTicketMock(...args)
}));

vi.mock('../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args)
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  __esModule: true,
  default: ({ onSelect, selectedClientId }: any) => {
    useEffect(() => {
      if (!selectedClientId) {
        onSelect('client-1');
      }
    }, [onSelect, selectedClientId]);
    return <div data-testid="client-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: ({ onValueChange }: any) => {
    useEffect(() => {
      onValueChange('user-1');
    }, [onValueChange]);
    return <div data-testid="user-picker" />;
  }
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({ onSelect }: any) => {
    useEffect(() => {
      onSelect('board-1');
    }, [onSelect]);
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

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ value }: { value?: Date }) => (
    <input data-testid="due-date" value={value ? value.toISOString() : ''} readOnly />
  )
}));

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: () => <input data-testid="due-time" />
}));

describe('QuickAddTicket prefills', () => {
  beforeEach(() => {
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

  it('initializes estimated hours from prefilledEstimatedHours', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledEstimatedHours={2}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('includes estimated_hours in FormData when > 0', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledTitle="Prefilled Title"
        prefilledDescription="Prefilled description"
        prefilledAssignedTo="user-1"
        prefilledEstimatedHours={2}
        prefilledClient={{ id: 'client-1', name: 'Acme' }}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());

    const selects = screen.getAllByTestId('custom-select');
    fireEvent.change(selects[0], { target: { value: 'status-1' } });
    fireEvent.change(selects[1], { target: { value: 'priority-1' } });

    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), {
      target: { value: 'Prefilled Title' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Ticket' }));

    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());

    const formData = addTicketMock.mock.calls[0][0] as FormData;
    expect(formData.get('estimated_hours')).toBe('2');
  });

  it('does not include estimated_hours in FormData when 0', async () => {
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={() => undefined}
        onTicketAdded={() => undefined}
        prefilledTitle="Prefilled Title"
        prefilledDescription="Prefilled description"
        prefilledAssignedTo="user-1"
        prefilledEstimatedHours={0}
        prefilledClient={{ id: 'client-1', name: 'Acme' }}
      />
    );

    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());

    const selects = screen.getAllByTestId('custom-select');
    fireEvent.change(selects[0], { target: { value: 'status-1' } });
    fireEvent.change(selects[1], { target: { value: 'priority-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Ticket' }));

    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());

    const formData = addTicketMock.mock.calls[0][0] as FormData;
    expect(formData.get('estimated_hours')).toBeNull();
  });
});
