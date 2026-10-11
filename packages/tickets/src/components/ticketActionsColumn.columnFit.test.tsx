// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { ColumnDefinition, ITicketListItem } from '@alga-psa/types';
import { computeColumnFit, getColumnLayout } from '@alga-psa/ui/components/dataTableColumnFit';
import { createTicketColumns } from '../lib/ticket-columns';
import { TICKET_COLUMNS } from '../lib/ticketColumnCatalog';
import { createTicketActionsColumn } from './ticketActionsColumn';

/**
 * Smoke run 9: the row ⋮ menu was one of the "3 columns hidden" at 1920px because
 * computeColumnFit only pins a trailing actions column whose dataIndex is 'actions'.
 *
 * The column set is built the way TicketingDashboard builds it: the real
 * createTicketColumns (dashboard options) plus the real createTicketActionsColumn.
 * Only the selection column is stubbed (it is component-bound); it carries the
 * same dataIndex and width as the dashboard's.
 */
const selectionColumn: ColumnDefinition<ITicketListItem> = {
  title: '',
  dataIndex: 'selection',
  width: '4%',
};

const buildDashboardColumns = () => [
  selectionColumn,
  ...createTicketColumns({
    categories: [],
    boards: [],
    onTicketClick: () => {},
    showClient: true,
  }),
  createTicketActionsColumn({ t: (_key, fallback) => fallback, onDuplicate: () => {} }),
];

describe('ticket list actions column fit', () => {
  it.each([1920, 1280])('keeps the actions column visible at %ipx', (width) => {
    const columns = buildDashboardColumns();
    const { visibleColumnIds } = computeColumnFit(columns, width, getColumnLayout(columns, width));
    expect(visibleColumnIds).toContain('actions');
  });

  it('is the last column and its id is not a catalog column', () => {
    const columns = buildDashboardColumns();
    expect(String(columns[columns.length - 1].dataIndex)).toBe('actions');
    expect(TICKET_COLUMNS.map((c) => c.key)).not.toContain('actions');
    expect(columns.filter((c) => c.dataIndex === 'actions')).toHaveLength(1);
  });
});
