import type { Knex } from 'knex';
import {
  normalizeTicketListSortKey,
  type TicketListSortKey,
} from '../lib/ticketListSort';

/**
 * Physical ORDER BY mapping for the ticket list.
 *
 * A schema-valid sort key that has no SQL mapping must not silently fall back to
 * `entered_at`: the schema would accept a click and the list would quietly sort
 * by the wrong column. Typing the map as `Record<TicketListSortKey, …>` makes
 * adding a key to the shared contract fail the build here until SQL support is
 * supplied.
 *
 * Aliases come from `buildTicketListBaseQuery`:
 *   au → users on t.assigned_to, tm → teams on t.assigned_team_id,
 *   cn → contacts on t.contact_name_id.
 */
export interface TicketListSortSpec {
  column?: string;
  rawExpression?: string;
  /** Orders by the tenant-bound latest-activity expression; see ticketLatestActivitySql. */
  activity?: true;
}

export interface TicketLatestActivitySql {
  sql: string;
  bindings: Knex.RawBinding[];
}

/**
 * "Most recent activity" on a ticket: the newest of the ticket's own timestamps
 * and its newest visible comment. Scheduled/canceled and soft-deleted comments
 * are excluded so a comment queued for next week cannot float a ticket to the
 * top. `GREATEST` ignores NULLs in Postgres, so a ticket with no comments falls
 * back to updated_at/entered_at instead of sorting as NULL.
 *
 * The subquery pins the tenant BOTH as a bound constant and as the `t.tenant`
 * correlation. With the correlation alone Citus cannot prove the subquery stays
 * on the outer row's shard, drops the whole list query out of single-shard
 * routing, and fans it out to every shard (32 tasks per page load in prod);
 * with the constant it routes to one shard.
 *
 * The expression references only alias `t` (and its own `c_act`), which is why
 * it can be reused as an ORDER BY term, a window-function ORDER BY in
 * getAdjacentTicketIds, and a selected column, each time with `bindings`.
 *
 * `publicOnly` is the client-portal variant: counts only non-internal comments
 * on non-internal threads, so `latest_activity_at` cannot disclose the timing
 * of internal notes (same rule as the portal comment list).
 */
export function ticketLatestActivitySql(
  tenant: string,
  options: { publicOnly?: boolean } = {}
): TicketLatestActivitySql {
  const threadJoin = options.publicOnly
    ? ' LEFT JOIN comment_threads ct_act ON ct_act.tenant = c_act.tenant AND ct_act.thread_id = c_act.thread_id'
    : '';
  const visibility = options.publicOnly
    ? ' AND c_act.is_internal = false AND (ct_act.is_internal IS NULL OR ct_act.is_internal = false)'
    : '';

  return {
    sql: `GREATEST(t.updated_at, t.entered_at, (SELECT MAX(c_act.created_at) FROM comments c_act${threadJoin} WHERE c_act.tenant = ? AND c_act.tenant = t.tenant AND c_act.ticket_id = t.ticket_id AND c_act.deleted_at IS NULL AND c_act.publish_state = 'published'${visibility}))`,
    bindings: [tenant],
  };
}

export const TICKET_LIST_SORT_SQL: Record<TicketListSortKey, TicketListSortSpec> = {
  ticket_number: { column: 't.ticket_number' },
  title: { column: 't.title' },
  status_name: { column: 's.name' },
  priority_name: { column: 'p.priority_name' },
  board_name: { column: 'c.board_name' },
  category_name: { column: 'cat.category_name' },
  client_name: { column: 'comp.client_name' },
  contact_name: { column: 'cn.full_name' },
  entered_at: { column: 't.entered_at' },
  entered_by_name: { rawExpression: "COALESCE(CONCAT(u.first_name, ' ', u.last_name), '')" },
  due_date: { column: 't.due_date' },
  assigned_to_name: { rawExpression: "COALESCE(CONCAT(au.first_name, ' ', au.last_name), '')" },
  assigned_team_name: { column: 'tm.team_name' },
  updated_at: { column: 't.updated_at' },
  latest_activity_at: { activity: true },
};

/** Resolve a possibly-untrusted sort key to its SQL mapping, defaulting on junk. */
export function resolveTicketListSortSpec(sortBy: string | undefined): TicketListSortSpec {
  return TICKET_LIST_SORT_SQL[normalizeTicketListSortKey(sortBy)];
}
