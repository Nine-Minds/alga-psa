/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
