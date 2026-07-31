import { describe, expect, it } from 'vitest';
import {
  buildTicketStatusFilterOptions,
  createTicketStatusNameFilterValue,
  parseTicketStatusFilterValue,
  TICKET_STATUS_FILTER_ALL,
  TICKET_STATUS_FILTER_CLOSED,
  TICKET_STATUS_FILTER_OPEN,
  type TicketStatusFilterOption,
} from './ticketStatusFilter';

const STATUS_OPTIONS: TicketStatusFilterOption[] = [
  { value: TICKET_STATUS_FILTER_OPEN, label: 'All open statuses' },
  { value: TICKET_STATUS_FILTER_ALL, label: 'All Statuses' },
  { value: 'status-a-new', label: 'New', statusName: 'New', boardId: 'board-a', isClosed: false },
  { value: 'status-b-new', label: 'New', statusName: 'New', boardId: 'board-b', isClosed: false },
  { value: 'status-a-closed', label: 'Closed', statusName: 'Closed', boardId: 'board-a', isClosed: true },
  { value: 'status-b-review', label: 'Review', statusName: 'Review', boardId: 'board-b', isClosed: false },
];

describe('ticketStatusFilter', () => {
  it('parses grouped status-name filter values', () => {
    expect(parseTicketStatusFilterValue(createTicketStatusNameFilterValue('Needs Review'))).toEqual({
      kind: 'name',
      statusName: 'Needs Review',
    });
  });

  it('parses the closed sentinel filter value', () => {
    expect(parseTicketStatusFilterValue(TICKET_STATUS_FILTER_CLOSED)).toEqual({
      kind: 'closed',
    });
  });

  it('dedupes matching status names across boards in all-status mode', () => {
    const options = buildTicketStatusFilterOptions(
      STATUS_OPTIONS,
      undefined,
      TICKET_STATUS_FILTER_ALL
    );

    expect(options.map(option => option.value)).toEqual([
      TICKET_STATUS_FILTER_OPEN,
      TICKET_STATUS_FILTER_ALL,
      createTicketStatusNameFilterValue('New'),
      createTicketStatusNameFilterValue('Closed'),
      createTicketStatusNameFilterValue('Review'),
    ]);
  });

  it('still shows closed grouped options when the open sentinel is selected', () => {
    const options = buildTicketStatusFilterOptions(
      STATUS_OPTIONS,
      undefined,
      TICKET_STATUS_FILTER_OPEN
    );

    expect(options.map(option => option.value)).toEqual([
      TICKET_STATUS_FILTER_OPEN,
      TICKET_STATUS_FILTER_ALL,
      createTicketStatusNameFilterValue('New'),
      createTicketStatusNameFilterValue('Closed'),
      createTicketStatusNameFilterValue('Review'),
    ]);
  });

  it('maps bare open/closed/all aliases to sentinel kinds instead of uuid-typed SQL', () => {
    expect(parseTicketStatusFilterValue('open')).toEqual({ kind: 'open' });
    expect(parseTicketStatusFilterValue('CLOSED')).toEqual({ kind: 'closed' });
    expect(parseTicketStatusFilterValue('all')).toEqual({ kind: 'all' });
  });

  it('routes non-uuid strings to a name match rather than a status id', () => {
    expect(parseTicketStatusFilterValue('In Progress')).toEqual({ kind: 'name', statusName: 'In Progress' });
    expect(parseTicketStatusFilterValue('123e4567-e89b-12d3-a456-426614174000')).toEqual({
      kind: 'id',
      statusId: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('scopes grouped options to the selected board before deduping', () => {
    const options = buildTicketStatusFilterOptions(
      STATUS_OPTIONS,
      'board-a',
      TICKET_STATUS_FILTER_ALL
    );

    expect(options.map(option => option.value)).toEqual([
      TICKET_STATUS_FILTER_OPEN,
      TICKET_STATUS_FILTER_ALL,
      createTicketStatusNameFilterValue('New'),
      createTicketStatusNameFilterValue('Closed'),
    ]);
  });
});
