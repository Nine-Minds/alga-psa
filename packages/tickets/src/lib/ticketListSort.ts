/**
 * The one supported ticket-list sort-key contract.
 *
 * `DataTable` emits a column's `dataIndex` as the sort key, and the ticket
 * board exposes `assigned_to_name` as a sortable column. Historically the Zod
 * enum, the client URL parser and the server page parser each maintained their
 * own copy of the allow-list, and all three lagged the column catalog — clicking
 * the Assigned To header produced `sortBy=assigned_to_name`, which validation
 * rejected and the list surfaced as a fetch error.
 *
 * This module is the single source of truth those three surfaces read. It is a
 * leaf (no imports) so it is safe for client bundles, server actions and the SSR
 * page alike.
 */
export const TICKET_LIST_SORT_KEYS = [
  'ticket_number',
  'title',
  'status_name',
  'priority_name',
  'board_name',
  'category_name',
  'client_name',
  'entered_at',
  'entered_by_name',
  'due_date',
  'assigned_to_name',
  'assigned_team_name',
  'updated_at',
] as const;

export type TicketListSortKey = (typeof TICKET_LIST_SORT_KEYS)[number];

/** The sort key the list falls back to when none (or an unknown one) is given. */
export const DEFAULT_TICKET_LIST_SORT_KEY: TicketListSortKey = 'entered_at';

export function isTicketListSortKey(value: unknown): value is TicketListSortKey {
  return (
    typeof value === 'string' &&
    (TICKET_LIST_SORT_KEYS as readonly string[]).includes(value)
  );
}

/** Coerce an untrusted value to a supported key, defaulting instead of throwing. */
export function normalizeTicketListSortKey(value: unknown): TicketListSortKey {
  return isTicketListSortKey(value) ? value : DEFAULT_TICKET_LIST_SORT_KEY;
}
