/**
 * Selection plumbing shared by the Tickets list's bulk actions, bundle master
 * picker, and print path when smart search is on.
 *
 * Smart search renders rows the ordinary paginated list does not hold, so a
 * selection made from a streamed bucket is invisible to anything that only
 * reads `tickets`. These helpers resolve a selection against every
 * authoritative source (the ordinary list, streamed smart rows, and by-id
 * hydration) so bulk actions and printing see the same rows the user selected.
 * Enumeration also checks the initiating run before applying a selection or
 * fallback, so late responses cannot restore a superseded run's selection.
 */

import type { ITicketListFilters, ITicketListItem } from '@alga-psa/types';

/** Apply enumeration or its fallback only while the initiating search is current. */
export async function selectMatchingTickets({
  loadIds,
  isCurrent,
  fallbackIds,
  onSelect,
  onError,
}: {
  loadIds: () => Promise<string[]>;
  isCurrent: () => boolean;
  fallbackIds: string[];
  onSelect: (ids: string[]) => void;
  onError: (error: unknown) => void;
}): Promise<void> {
  let ids: string[];
  try {
    ids = await loadIds();
  } catch (error) {
    if (!isCurrent()) return;
    onError(error);
    onSelect(fallbackIds);
    return;
  }
  if (isCurrent()) onSelect(ids);
}

/**
 * One smart search run's streamed rows. `generation` and `runKey` identify the
 * run, so a report from a superseded run (a stale panel callback or a hydration
 * that resolved after the run changed) can be discarded rather than leak an old
 * board's tickets into the current candidate set.
 */
export interface SmartSearchRunCache<TRow> {
  runKey: string;
  generation: number;
  byId: Record<string, TRow>;
}

export interface SmartSearchRunReport<TRow> {
  runKey: string;
  generation: number;
  rows: ReadonlyArray<TRow>;
}

export function createSmartSearchRunCache<TRow>(runKey: string, generation: number): SmartSearchRunCache<TRow> {
  return { runKey, generation, byId: {} };
}

/**
 * Merge a panel report into the run cache. A report whose run key or generation
 * does not match the cache is ignored, so an explicit rerun (or a callback from
 * an unmounted panel) can never repopulate the previous run's rows.
 */
export function mergeSmartSearchRunRows<TRow extends { ticket_id?: string }>(
  cache: SmartSearchRunCache<TRow>,
  report: SmartSearchRunReport<TRow>
): SmartSearchRunCache<TRow> {
  if (report.generation !== cache.generation || report.runKey !== cache.runKey) {
    return cache;
  }
  let changed = false;
  const byId = { ...cache.byId };
  for (const row of report.rows) {
    const id = row.ticket_id;
    if (typeof id === 'string' && id.length > 0 && byId[id] !== row) {
      byId[id] = row;
      changed = true;
    }
  }
  return changed ? { ...cache, byId } : cache;
}

/**
 * Rows the cache holds for the run active right now. Any other run — or when
 * smart mode is off — yields nothing, so an inactive cache can never supply an
 * ordinary-list action.
 */
export function smartSearchRunRows<TRow>(
  cache: SmartSearchRunCache<TRow>,
  activeRunKey: string | null
): TRow[] {
  if (!activeRunKey || cache.runKey !== activeRunKey) {
    return [];
  }
  return Object.values(cache.byId);
}

export function smartSearchRunCandidateIds<TRow extends { ticket_id?: string }>(
  cache: SmartSearchRunCache<TRow>,
  activeRunKey: string | null
): string[] {
  return smartSearchRunRows(cache, activeRunKey)
    .map((row) => row.ticket_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

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
 * the scope captured when the active run started — never the current chips,
 * which may have changed while only the "run again" prompt is showing — and the
 * typed text is the Jev query, never a keyword filter, so passing the export
 * filters would keep the keyword narrowing and select far fewer tickets.
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
