// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { TICKET_LIST_SORT_KEYS } from '../lib/ticketListSort';
import {
  resolveTicketListSortSpec,
  ticketLatestActivitySql,
  TICKET_LIST_SORT_SQL,
} from './ticketListSortSql';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INTERNAL = ticketLatestActivitySql(TENANT);
const PUBLIC = ticketLatestActivitySql(TENANT, { publicOnly: true });

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

  it('marks latest_activity_at as the tenant-bound activity sort', () => {
    // The expression needs the tenant as a binding, so the map carries a marker
    // and the callers build the SQL per request via ticketLatestActivitySql.
    expect(TICKET_LIST_SORT_SQL.latest_activity_at).toEqual({ activity: true });
  });

  it('keeps the activity expression correlated on alias t only', () => {
    // Reused verbatim as an ORDER BY term, a window ORDER BY and a selected
    // column: any alias other than `t`/its own `c_act` would break one of them.
    expect(INTERNAL.sql).toContain('GREATEST(t.updated_at, t.entered_at');
    expect(INTERNAL.sql).toContain('MAX(c_act.created_at)');
    expect(INTERNAL.sql).toContain('c_act.tenant = t.tenant');
    expect(INTERNAL.sql).toContain('c_act.ticket_id = t.ticket_id');
    // Scheduled/canceled and soft-deleted comments must not count as activity.
    expect(INTERNAL.sql).toContain('c_act.deleted_at IS NULL');
    expect(INTERNAL.sql).toContain("c_act.publish_state = 'published'");
  });

  it('pins the tenant as a bound constant so Citus routes the list to one shard', () => {
    // The `t.tenant` correlation alone drops the whole list query out of
    // single-shard routing and fans it out to every shard; the constant keeps
    // it on one. Exactly one placeholder, bound to the tenant.
    expect(INTERNAL.sql).toContain('c_act.tenant = ? AND c_act.tenant = t.tenant');
    expect(INTERNAL.sql.split('?')).toHaveLength(2);
    expect(INTERNAL.bindings).toEqual([TENANT]);
    expect(PUBLIC.sql.split('?')).toHaveLength(2);
    expect(PUBLIC.bindings).toEqual([TENANT]);
  });

  it('hides internal comments from the client-portal activity expression', () => {
    // A portal contact must not be able to infer when an agent wrote an
    // internal note, so the portal variant counts only client-visible comments
    // on client-visible threads (same rule as the portal comment list).
    expect(PUBLIC.sql).toContain('c_act.is_internal = false');
    expect(PUBLIC.sql).toContain(
      'LEFT JOIN comment_threads ct_act ON ct_act.tenant = c_act.tenant AND ct_act.thread_id = c_act.thread_id',
    );
    expect(PUBLIC.sql).toContain('(ct_act.is_internal IS NULL OR ct_act.is_internal = false)');
    // Everything the internal expression guarantees still holds.
    expect(PUBLIC.sql).toContain('GREATEST(t.updated_at, t.entered_at');
    expect(PUBLIC.sql).toContain('c_act.tenant = ? AND c_act.tenant = t.tenant');
    expect(PUBLIC.sql).toContain('c_act.deleted_at IS NULL');
    expect(PUBLIC.sql).toContain("c_act.publish_state = 'published'");
    // The internal-facing expression stays unfiltered: agents see all activity.
    expect(INTERNAL.sql).not.toContain('is_internal');
    expect(INTERNAL.sql).not.toContain('comment_threads');
  });

  it('resolves unknown or absent keys to the entered_at default', () => {
    expect(resolveTicketListSortSpec('bogus')).toEqual(TICKET_LIST_SORT_SQL.entered_at);
    expect(resolveTicketListSortSpec(undefined)).toEqual(TICKET_LIST_SORT_SQL.entered_at);
  });
});
