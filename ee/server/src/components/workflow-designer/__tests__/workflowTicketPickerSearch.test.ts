import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getTicketsForListMock } = vi.hoisted(() => ({ getTicketsForListMock: vi.fn() }));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getTicketsForList: getTicketsForListMock,
}));

import {
  formatWorkflowTicketLabel,
  searchWorkflowTickets,
  toWorkflowTicketPickerOption,
} from '../workflowTicketPickerSearch';

describe('searchWorkflowTickets', () => {
  beforeEach(() => {
    getTicketsForListMock.mockReset();
  });

  it('runs a bounded search across all boards and maps tickets to picker options', async () => {
    getTicketsForListMock.mockResolvedValue({
      tickets: [
        {
          ticket_id: 't-1',
          ticket_number: 'TIC001122',
          title: 'Server down',
          client_name: 'Acme',
          board_name: 'Urgent Matters',
          status_name: 'Open',
        },
      ],
      totalCount: 1,
      metadata: {},
    });

    const result = await searchWorkflowTickets({ search: ' 1122 ', page: 2, limit: 25 });

    expect(getTicketsForListMock).toHaveBeenCalledWith(
      expect.objectContaining({ boardFilterState: 'all', searchQuery: '1122' }),
      2,
      25
    );
    expect(result).toEqual({
      options: [
        {
          value: 't-1',
          label: 'TIC001122 · Server down',
          secondaryLabel: 'Acme · Urgent Matters · Open',
        },
      ],
      total: 1,
    });
  });

  it('omits the search filter for an empty term so recent tickets are listed', async () => {
    getTicketsForListMock.mockResolvedValue({ tickets: [], totalCount: 0, metadata: {} });

    await searchWorkflowTickets({ search: '   ', page: 1, limit: 25 });

    expect(getTicketsForListMock.mock.calls[0][0].searchQuery).toBeUndefined();
  });

  it('throws the server message when the action returns a permission or message error', async () => {
    getTicketsForListMock.mockResolvedValueOnce({ permissionError: 'Permission denied: Cannot view tickets' });
    await expect(searchWorkflowTickets({ search: 'x', page: 1, limit: 25 })).rejects.toThrow(
      'Permission denied: Cannot view tickets'
    );

    getTicketsForListMock.mockResolvedValueOnce({ actionError: 'Filters are no longer valid' });
    await expect(searchWorkflowTickets({ search: 'x', page: 1, limit: 25 })).rejects.toThrow(
      'Filters are no longer valid'
    );
  });
});

describe('ticket option formatting', () => {
  it('falls back to the id and drops placeholder names', () => {
    expect(formatWorkflowTicketLabel({ ticket_number: null, title: null }, 't-9')).toBe('t-9');
    expect(
      toWorkflowTicketPickerOption({ ticket_id: 't-2', title: 'Printer', client_name: 'Unknown', status_name: '' })
    ).toEqual({ value: 't-2', label: 'Printer' });
    expect(toWorkflowTicketPickerOption({ ticket_id: null, title: 'x' })).toBeNull();
  });
});
