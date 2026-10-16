// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { TICKET_LIST_SORT_KEYS } from '../lib/ticketListSort';
import {
  resolveTicketListSortSpec,
  TICKET_LATEST_ACTIVITY_PUBLIC_SQL,
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

  it('orders contact_name against the base query contacts alias', () => {
    // `cn` is the contacts join buildTicketListBaseQuery adds; any other alias
    // would make the ORDER BY (and the adjacent-ticket window) fail at runtime.
    expect(TICKET_LIST_SORT_SQL.contact_name).toEqual({ column: 'cn.full_name' });
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

  it('hides internal comments from the client-portal activity expression', () => {
    // A portal contact must not be able to infer when an agent wrote an
    // internal note, so the portal variant counts only client-visible comments
    // on client-visible threads (same rule as the portal comment list).
    expect(TICKET_LATEST_ACTIVITY_PUBLIC_SQL).toContain('c_act.is_internal = false');
    expect(TICKET_LATEST_ACTIVITY_PUBLIC_SQL).toContain(
      'LEFT JOIN comment_threads ct_act ON ct_act.tenant = c_act.tenant AND ct_act.thread_id = c_act.thread_id',
    );
    expect(TICKET_LATEST_ACTIVITY_PUBLIC_SQL).toContain(
      '(ct_act.is_internal IS NULL OR ct_act.is_internal = false)',
    );
    // Everything the internal expression guarantees still holds.
    expect(TICKET_LATEST_ACTIVITY_PUBLIC_SQL).toContain('GREATEST(t.updated_at, t.entered_at');
    expect(TICKET_LATEST_ACTIVITY_PUBLIC_SQL).toContain('c_act.deleted_at IS NULL');
    expect(TICKET_LATEST_ACTIVITY_PUBLIC_SQL).toContain("c_act.publish_state = 'published'");
    // The internal-facing expression stays unfiltered: agents see all activity.
    expect(TICKET_LATEST_ACTIVITY_SQL).not.toContain('is_internal');
    expect(TICKET_LATEST_ACTIVITY_SQL).not.toContain('comment_threads');
  });

  it('resolves unknown or absent keys to the entered_at default', () => {
    expect(resolveTicketListSortSpec('bogus')).toEqual(TICKET_LIST_SORT_SQL.entered_at);
    expect(resolveTicketListSortSpec(undefined)).toEqual(TICKET_LIST_SORT_SQL.entered_at);
  });
});
