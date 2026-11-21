/** @vitest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTicketColumns } from './ticket-columns';
import { ChangedSinceLoad } from './changedSinceLoad';
import type { TicketListChange } from './listChangeFilters';

const liveEvent: TicketListChange = {
  ticketId: 'ticket-a', changeKind: 'updated', boardId: 'board-a', statusId: '00000000-0000-4000-8000-000000000001',
  statusIsClosed: false, assigneeIds: [], searchText: 'Printer', actorUserId: 'other', updatedAt: '2026-11-02T12:01:00Z',
};

describe('live ticket row indicators', () => {
  it('renders the changed-row badge while leaving the loaded row data untouched', () => {
    const rows = Object.freeze([{ ticket_id: 'ticket-a', title: 'Printer offline', ticket_number: 'T-42' }]);
    const before = JSON.stringify(rows);
    const state = new ChangedSinceLoad();
    state.load(rows.map(row => row.ticket_id), { boardId: 'board-a' }, 'me', Date.parse('2026-11-02T12:00:00Z'));
    expect(state.record(liveEvent)).toBe(true);
    const columns = createTicketColumns({ categories: [], boards: [], displaySettings: { list: { columnVisibility: {} } }, onTicketClick: () => {}, isTicketChanged: (id: string) => state.has(id) } as any);
    const title = columns.find((column: any) => column.dataIndex === 'title') as any;
    const row = rows[0] as any;
    const rendered = renderToStaticMarkup(<>{title.render(row.title, row)}</>);
    expect(rendered).toContain('Updated');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
