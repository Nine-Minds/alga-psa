import { describe, expect, it } from 'vitest';
import { buildFocusedListFilters, createTicketListFocus } from './ticketListFocus';
import { TICKET_WHERE_MAX_TICKET_IDS } from './ticketWhere';
import { ticketWhereSchema } from './ticketWhere';

describe('ticket list focus request', () => {
  it('is the ticket_id clause alone with all boards, individual bundles and the list sort', () => {
    const request = buildFocusedListFilters({ ticketIds: ['a', 'b'] }, { sortBy: 'title', sortDirection: 'asc' });
    expect(request.where).toEqual({ join: 'and', clauses: [{ path: 'ticket_id', operator: 'in', value: ['a', 'b'] }] });
    expect(request.boardFilterState).toBe('all');
    expect(request.bundleView).toBe('individual');
    expect(request.showOpenOnly).toBe(false);
    expect(request.sortBy).toBe('title');
    expect(request.sortDirection).toBe('asc');
    expect(request.boardIds).toBeUndefined();
    expect(request.searchQuery).toBe('');
  });

  it('trims to the shared cap and marks the focus capped', () => {
    const ids = Array.from({ length: TICKET_WHERE_MAX_TICKET_IDS + 3 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const focus = createTicketListFocus('new', ids);
    expect(focus.ticketIds).toHaveLength(TICKET_WHERE_MAX_TICKET_IDS);
    expect(focus.capped).toBe(true);
    const request = buildFocusedListFilters(focus, { sortBy: 'entered_at', sortDirection: 'desc' });
    expect(ticketWhereSchema.safeParse(request.where).success).toBe(true);
  });

  it('is capped when more were counted than listed, and not otherwise', () => {
    expect(createTicketListFocus('updated', ['a'], 4).capped).toBe(true);
    expect(createTicketListFocus('updated', ['a']).capped).toBe(false);
  });
});
