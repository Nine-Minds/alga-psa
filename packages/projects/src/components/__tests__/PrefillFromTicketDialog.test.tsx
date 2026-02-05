/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrefillFromTicketDialog from '../PrefillFromTicketDialog';

const getTicketsForListMock = vi.fn();
const getConsolidatedTicketDataMock = vi.fn();

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketsForList: (...args: unknown[]) => getTicketsForListMock(...args)
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getConsolidatedTicketData: (...args: unknown[]) => getConsolidatedTicketDataMock(...args)
}));

vi.mock('../TicketSelect', () => ({
  __esModule: true,
  default: ({ options, value, onValueChange, searchValue, onSearchChange }: any) => (
    <div>
      <input
        aria-label="ticket-search"
        value={searchValue}
        onChange={(event) => onSearchChange?.(event.target.value)}
      />
      <select
        aria-label="ticket-select"
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
    </div>
  )
}));

describe('PrefillFromTicketDialog', () => {
  beforeEach(() => {
    getTicketsForListMock.mockResolvedValue([]);
    getConsolidatedTicketDataMock.mockResolvedValue({});
  });

  it('renders ticket search input and TicketSelect dropdown', () => {
    render(
      <PrefillFromTicketDialog
        open={true}
        onOpenChange={() => undefined}
        onPrefill={() => undefined}
      />
    );

    expect(screen.getByLabelText('ticket-search')).toBeInTheDocument();
    expect(screen.getByLabelText('ticket-select')).toBeInTheDocument();
  });

  it('fetches tickets lazily when dialog opens', () => {
    const { rerender } = render(
      <PrefillFromTicketDialog
        open={false}
        onOpenChange={() => undefined}
        onPrefill={() => undefined}
      />
    );

    expect(getTicketsForListMock).not.toHaveBeenCalled();

    rerender(
      <PrefillFromTicketDialog
        open={true}
        onOpenChange={() => undefined}
        onPrefill={() => undefined}
      />
    );

    expect(getTicketsForListMock).toHaveBeenCalledTimes(1);
  });

  it('renders auto-link checkbox checked by default', () => {
    render(
      <PrefillFromTicketDialog
        open={true}
        onOpenChange={() => undefined}
        onPrefill={() => undefined}
      />
    );

    const checkbox = screen.getByLabelText('Link this ticket to the task') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('excludes ticket link when auto-link is unchecked', async () => {
    getTicketsForListMock.mockResolvedValue([
      { ticket_id: 'ticket-1', ticket_number: 'T-001', title: 'Printer issue', status_name: 'New' }
    ]);
    getConsolidatedTicketDataMock.mockResolvedValue({
      ticket_id: 'ticket-1',
      ticket_number: 'T-001',
      title: 'Printer issue',
      status_name: 'New',
      is_closed: false
    });

    const onPrefill = vi.fn();

    render(
      <PrefillFromTicketDialog
        open={true}
        onOpenChange={() => undefined}
        onPrefill={onPrefill}
      />
    );

    await waitFor(() => expect(getTicketsForListMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('ticket-select'), {
      target: { value: 'ticket-1' }
    });

    const checkbox = screen.getByLabelText('Link this ticket to the task');
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole('button', { name: 'Prefill' }));

    expect(onPrefill).toHaveBeenCalledWith(
      expect.objectContaining({ shouldLink: false })
    );
  });

  it('calls getConsolidatedTicketData for the selected ticket on confirm', async () => {
    getTicketsForListMock.mockResolvedValue([
      { ticket_id: 'ticket-2', ticket_number: 'T-002', title: 'VPN issue', status_name: 'New' }
    ]);
    getConsolidatedTicketDataMock.mockResolvedValue({
      ticket_id: 'ticket-2',
      ticket_number: 'T-002',
      title: 'VPN issue'
    });

    render(
      <PrefillFromTicketDialog
        open={true}
        onOpenChange={() => undefined}
        onPrefill={() => undefined}
      />
    );

    await waitFor(() => expect(getTicketsForListMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('ticket-select'), {
      target: { value: 'ticket-2' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Prefill' }));

    expect(getConsolidatedTicketDataMock).toHaveBeenCalledWith('ticket-2');
  });
});
