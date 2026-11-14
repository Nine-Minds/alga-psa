// @vitest-environment node

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTicketColumns } from './ticket-columns';
import { TICKET_COLUMNS, resolveTicketColumnVisibility } from './ticketColumnCatalog';

function columns(columnVisibility: Record<string, boolean>) {
  return createTicketColumns({
    categories: [],
    boards: [],
    displaySettings: { list: { columnVisibility } },
    onTicketClick: () => {},
    t: (_key: string, fallback: string) => fallback,
  } as any);
}

/** T066: the Location column is offered by the picker and off until it is asked for (OQ2). */
describe('Location column', () => {
  it('is in the catalog, off by default, and overridable per user', () => {
    const location = TICKET_COLUMNS.find((column) => column.key === 'location');
    expect(location?.defaultVisible).toBe(false);
    expect(resolveTicketColumnVisibility().location).toBe(false);
    expect(resolveTicketColumnVisibility({ location: true }).location).toBe(true);
  });

  it('is not built unless it is enabled', () => {
    expect(columns({ contact: true }).some((column: any) => column.dataIndex === 'ticket_location_name')).toBe(false);
  });

  it('shows the location name of the row, and nothing for a ticket with no location', () => {
    const column = columns({ location: true }).find((c: any) => c.dataIndex === 'ticket_location_name') as any;
    expect(column.title).toBe('Location');
    expect(renderToStaticMarkup(<>{column.render('Warehouse', {})}</>)).toContain('Warehouse');
    expect(renderToStaticMarkup(<>{column.render(null, {})}</>)).not.toContain('Warehouse');
  });
});
