/**
 * Selection plumbing shared by the Tickets list's bulk actions, bundle master
 * picker, and print path when smart search is on.
 *
 * Smart search renders rows the ordinary paginated list does not hold, so a
 * selection made from a streamed bucket is invisible to anything that only
 * reads `tickets`. These helpers resolve a selection against every
 * authoritative source (the ordinary list, streamed smart rows, and by-id
 * hydration) so bulk actions and printing see the same rows the user selected.
 * They are pure so the behavior is testable without mounting the dashboard.
 */

import type { ITicketListFilters, ITicketListItem } from '@alga-psa/types';

export interface SelectedTicketDetail {
  ticket_id: string;
  ticket_number?: string;
  title?: string;
  client_id?: string | null;
  client_name?: string;
  board_id?: string | null;
}

function indexSelectedRows(
  selectedIds: Iterable<string>,
  sources: ReadonlyArray<ReadonlyArray<ITicketListItem>>
): Map<string, ITicketListItem> {
  const wanted = new Set(selectedIds);
  const byId = new Map<string, ITicketListItem>();
  for (const source of sources) {
    for (const row of source) {
      const id = row.ticket_id;
      // First source wins, so the ordinary list's row shape is preferred and a
      // streamed row only fills a gap.
      if (typeof id === 'string' && id.length > 0 && wanted.has(id) && !byId.has(id)) {
        byId.set(id, row);
      }
    }
  }
  return byId;
}

/** The rows for `selectedIds`, looked up across every source, in source order. */
export function collectSelectedTicketRows(
  selectedIds: ReadonlyArray<string>,
  sources: ReadonlyArray<ReadonlyArray<ITicketListItem>>
): { rows: ITicketListItem[]; missingIds: string[] } {
  const byId = indexSelectedRows(selectedIds, sources);
  const missingIds = selectedIds.filter((id) => !byId.has(id));
  return { rows: Array.from(byId.values()), missingIds };
}

/** The detail shape the bundle master picker and bulk-error labels render. */
export function buildSelectedTicketDetails(
  selectedIds: Iterable<string>,
  sources: ReadonlyArray<ReadonlyArray<ITicketListItem>>
): SelectedTicketDetail[] {
  return Array.from(indexSelectedRows(selectedIds, sources).values())
    .map((ticket) => ({
      ticket_id: ticket.ticket_id as string,
      ticket_number: ticket.ticket_number,
      title: ticket.title,
      client_id: ticket.client_id ?? null,
      client_name: ticket.client_name,
      board_id: ticket.board_id ?? null,
    }))
    .sort((a, b) => {
      if (a.ticket_number && b.ticket_number) {
        return a.ticket_number.localeCompare(b.ticket_number, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (a.title && b.title) {
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      }
      return 0;
    });
}

/**
 * The scope "select all matching" enumerates. In smart mode the candidate set is
 * the chip filters alone; the typed text is the Jev query, never a keyword
 * filter, so passing the export filters would keep the keyword narrowing and
 * select far fewer tickets.
 */
export function selectAllMatchingScope(
  smartSearchActive: boolean,
  smartSearchFilters: ITicketListFilters,
  exportFilters: ITicketListFilters
): ITicketListFilters {
  return smartSearchActive ? smartSearchFilters : exportFilters;
}

/**
 * Ids to keep when the authoritative enumeration fails: the smart candidate set
 * the panel has streamed, or the ordinary page's rows.
 */
export function selectAllMatchingFallbackIds(
  smartSearchActive: boolean,
  smartCandidateIds: ReadonlyArray<string>,
  pageIds: ReadonlyArray<string>
): string[] {
  return smartSearchActive ? Array.from(new Set(smartCandidateIds)) : Array.from(new Set(pageIds));
}

/**
 * Reconcile the selection with the ordinary paginated list after it refreshes.
 * While smart mode is active the ordinary list is not the authority for the
 * candidate set, so a selected streamed id must survive a page refresh.
 */
export function pruneSelectedTicketIds(
  previous: Set<string>,
  validIds: ReadonlySet<string>,
  smartSearchActive: boolean
): Set<string> {
  if (smartSearchActive || previous.size === 0) {
    return previous;
  }
  let changed = false;
  const next = new Set<string>();
  for (const id of previous) {
    if (validIds.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  if (!changed && next.size === previous.size) {
    return previous;
  }
  return next;
}
