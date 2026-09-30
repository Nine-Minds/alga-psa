// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { TICKET_LIST_SORT_KEYS } from '../lib/ticketListSort';
import {
  resolveTicketListSortSpec,
  TICKET_LATEST_ACTIVITY_SQL,
  TICKET_LIST_SORT_SQL,
} from './ticketListSortSql';

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

  it('orders latest_activity_at by the shared activity expression', () => {
    expect(TICKET_LIST_SORT_SQL.latest_activity_at).toEqual({
      rawExpression: TICKET_LATEST_ACTIVITY_SQL,
    });
  });

  it('keeps the activity expression correlated on alias t only', () => {
    // Reused verbatim as an ORDER BY term, a window ORDER BY and a selected
    // column: any alias other than `t`/its own `c_act` would break one of them.
    expect(TICKET_LATEST_ACTIVITY_SQL).toContain('GREATEST(t.updated_at, t.entered_at');
    expect(TICKET_LATEST_ACTIVITY_SQL).toContain('MAX(c_act.created_at)');
    expect(TICKET_LATEST_ACTIVITY_SQL).toContain('c_act.tenant = t.tenant');
    expect(TICKET_LATEST_ACTIVITY_SQL).toContain('c_act.ticket_id = t.ticket_id');
    // Scheduled/canceled and soft-deleted comments must not count as activity.
    expect(TICKET_LATEST_ACTIVITY_SQL).toContain('c_act.deleted_at IS NULL');
    expect(TICKET_LATEST_ACTIVITY_SQL).toContain("c_act.publish_state = 'published'");
  });

  it('resolves unknown or absent keys to the entered_at default', () => {
    expect(resolveTicketListSortSpec('bogus')).toEqual(TICKET_LIST_SORT_SQL.entered_at);
    expect(resolveTicketListSortSpec(undefined)).toEqual(TICKET_LIST_SORT_SQL.entered_at);
  });
});
