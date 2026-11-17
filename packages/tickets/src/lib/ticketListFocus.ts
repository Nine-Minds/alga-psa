import type { ITicketListFilters } from '@alga-psa/types';
import type { ChangedKind } from './changedSinceLoad';
import { TICKET_WHERE_MAX_TICKET_IDS } from './ticketWhere';
import { TICKET_STATUS_FILTER_ALL } from './ticketStatusFilter';

/**
 * A temporary overlay on the ticket list: "show exactly these tickets". It is held by the container
 * next to, never inside, the list's filters, so it cannot reach the URL, saved views or the dirty-view
 * baseline.
 */
export interface TicketListFocus {
  kind: ChangedKind;
  ticketIds: string[];
  /** More tickets of this kind changed than the focus can list (see TICKET_WHERE_MAX_TICKET_IDS). */
  capped: boolean;
}

/** Builds the focus for a kind from the tracker's ids, trimming to the `where` cap. */
export function createTicketListFocus(kind: ChangedKind, ticketIds: readonly string[], knownCount = ticketIds.length): TicketListFocus {
  const ids = ticketIds.slice(0, TICKET_WHERE_MAX_TICKET_IDS);
  return { kind, ticketIds: ids, capped: ticketIds.length > ids.length || knownCount > ids.length };
}

/**
 * The list request for a focus: one scope clause (`ticket_id in [...]`), every other filter replaced
 * rather than combined (an "updated" ticket may no longer match the list's filters), all boards, bundles
 * shown individually. Sort is the list's own.
 */
export function buildFocusedListFilters(
  focus: Pick<TicketListFocus, 'ticketIds'>,
  sort: { sortBy: string; sortDirection: 'asc' | 'desc' },
): ITicketListFilters {
  return {
    statusId: TICKET_STATUS_FILTER_ALL,
    priorityId: 'all',
    searchQuery: '',
    boardFilterState: 'all',
    showOpenOnly: false,
    bundleView: 'individual',
    sortBy: sort.sortBy,
    sortDirection: sort.sortDirection,
    where: { join: 'and', clauses: [{ path: 'ticket_id', operator: 'in', value: [...focus.ticketIds] }] },
  };
}
