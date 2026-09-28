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
 *   au → users on t.assigned_to, tm → teams on t.assigned_team_id.
 */
export interface TicketListSortSpec {
  column?: string;
  rawExpression?: string;
}

export const TICKET_LIST_SORT_SQL: Record<TicketListSortKey, TicketListSortSpec> = {
  ticket_number: { column: 't.ticket_number' },
  title: { column: 't.title' },
  status_name: { column: 's.name' },
  priority_name: { column: 'p.priority_name' },
  board_name: { column: 'c.board_name' },
  category_name: { column: 'cat.category_name' },
  client_name: { column: 'comp.client_name' },
  entered_at: { column: 't.entered_at' },
  entered_by_name: { rawExpression: "COALESCE(CONCAT(u.first_name, ' ', u.last_name), '')" },
  due_date: { column: 't.due_date' },
  assigned_to_name: { rawExpression: "COALESCE(CONCAT(au.first_name, ' ', au.last_name), '')" },
  assigned_team_name: { column: 'tm.team_name' },
  updated_at: { column: 't.updated_at' },
};

/** Resolve a possibly-untrusted sort key to its SQL mapping, defaulting on junk. */
export function resolveTicketListSortSpec(sortBy: string | undefined): TicketListSortSpec {
  return TICKET_LIST_SORT_SQL[normalizeTicketListSortKey(sortBy)];
}
