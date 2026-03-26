import { describe, expect, it } from 'vitest';
import {
  buildTicketStatusFilterOptions,
  createTicketStatusNameFilterValue,
  parseTicketStatusFilterValue,
  TICKET_STATUS_FILTER_ALL,
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
