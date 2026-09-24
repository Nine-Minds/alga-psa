// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { TICKET_LIST_SORT_KEYS } from '../lib/ticketListSort';
import { resolveTicketListSortSpec, TICKET_LIST_SORT_SQL } from './ticketListSortSql';

describe('TICKET_LIST_SORT_SQL', () => {
  it('maps every schema-valid sort key (the map is exhaustive)', () => {
    // The Record<TicketListSortKey, …> type makes this a build failure when a
    // key is added; this assertion catches a key quietly removed at runtime and
    // documents the contract.
    expect(Object.keys(TICKET_LIST_SORT_SQL).sort()).toEqual([...TICKET_LIST_SORT_KEYS].sort());
  });

  it('orders the three assignee/updated keys against existing aliases', () => {
    expect(TICKET_LIST_SORT_SQL.assigned_to_name.rawExpression).toContain('au.first_name');
    expect(TICKET_LIST_SORT_SQL.assigned_to_name.rawExpression).toContain('au.last_name');
    expect(TICKET_LIST_SORT_SQL.assigned_team_name).toEqual({ column: 'tm.team_name' });
    expect(TICKET_LIST_SORT_SQL.updated_at).toEqual({ column: 't.updated_at' });
  });

  it('resolves unknown or absent keys to the entered_at default', () => {
    expect(resolveTicketListSortSpec('bogus')).toEqual(TICKET_LIST_SORT_SQL.entered_at);
    expect(resolveTicketListSortSpec(undefined)).toEqual(TICKET_LIST_SORT_SQL.entered_at);
  });
});
