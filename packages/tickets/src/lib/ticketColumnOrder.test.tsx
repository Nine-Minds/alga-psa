// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createTicketColumns } from './ticket-columns';
import { TICKET_COLUMNS } from './ticketColumnCatalog';

/**
 * Column ordering had no authoring surface anywhere before board-level view
 * configuration: on-screen order was the catalog's declaration order, full stop.
 * These cases pin the two halves of the new contract — a stored order moves the
 * columns it may move, and cannot move the ones it may not.
 */

const baseOptions = {
  categories: [],
  boards: [],
  onTicketClick: () => {},
};

const keysOf = (columns: ReturnType<typeof createTicketColumns>) =>
  columns.map((column) => String(column.dataIndex));

describe('createTicketColumns column ordering', () => {
  it('falls back to catalog declaration order when no order is stored', () => {
    const withoutOrder = keysOf(createTicketColumns({ ...baseOptions }));
    const withEmptyOrder = keysOf(createTicketColumns({ ...baseOptions, columnOrder: [] }));
    expect(withEmptyOrder).toEqual(withoutOrder);
  });

  it('reorders the optional columns to match the stored order', () => {
    const columns = keysOf(createTicketColumns({
      ...baseOptions,
      columnOrder: ['client', 'assigned_to', 'status', 'priority', 'board', 'due_date'],
    }));

    // client_name is `client`, assigned_to_name is `assigned_to`, etc.
    expect(columns.indexOf('client_name')).toBeLessThan(columns.indexOf('assigned_to_name'));
    expect(columns.indexOf('assigned_to_name')).toBeLessThan(columns.indexOf('status_name'));
    expect(columns.indexOf('status_name')).toBeLessThan(columns.indexOf('priority_name'));
  });

  it('keeps the fixed title column first no matter what the stored order says', () => {
    // Sorting the whole column array instead of only the reorderable slots would
    // let a stored order drag the hero cell out of first position, producing an
    // arrangement the row renderer cannot actually express.
    const columns = keysOf(createTicketColumns({
      ...baseOptions,
      columnOrder: ['client', 'status', 'title'],
    }));

    expect(columns[0]).toBe('title');
  });

  it('does not reorder folded or tags columns', () => {
    const nonOptional = TICKET_COLUMNS
      .filter((column) => column.kind !== 'optional')
      .map((column) => column.dataIndex);

    const withOrder = keysOf(createTicketColumns({
      ...baseOptions,
      columnOrder: ['due_date', 'client', 'status'],
    }));
    const withoutOrder = keysOf(createTicketColumns({ ...baseOptions }));

    for (const dataIndex of nonOptional) {
      // Folded columns are not emitted on screen at all; whichever of them do
      // appear must sit at exactly the index they sat at before.
      expect(withOrder.indexOf(dataIndex)).toBe(withoutOrder.indexOf(dataIndex));
    }
  });

  it('ignores stored keys the catalog no longer knows', () => {
    const columns = keysOf(createTicketColumns({
      ...baseOptions,
      columnOrder: ['a_deleted_column', 'client', 'status'],
    }));

    expect(columns.indexOf('client_name')).toBeLessThan(columns.indexOf('status_name'));
    expect(columns).not.toContain('a_deleted_column');
  });

  it('still renders a column that was added to the catalog after the order was saved', () => {
    const columns = keysOf(createTicketColumns({
      ...baseOptions,
      // An order saved before `created` and `created_by` existed.
      columnOrder: ['status', 'priority'],
      displaySettings: { list: { columnVisibility: { created: true, created_by: true } } },
    }));

    expect(columns).toContain('entered_at');
    expect(columns).toContain('entered_by_name');
  });
});
