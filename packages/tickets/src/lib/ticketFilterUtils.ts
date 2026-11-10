import type { ITicketListFilters } from '@alga-psa/types';
import type { PredicateGroup } from '@alga-psa/predicates';
import { migrateTicketFilters } from '@alga-psa/list-views';
import { setWhereTagSelection, type WhereSelection } from './ticketWhereFilters';
import { decodeTicketWhere } from './ticketWhereUrl';
import {
  isTicketStatusOpenFilter,
  TICKET_STATUS_FILTER_OPEN,
} from './ticketStatusFilter';

/**
 * Default ticket list filters matching the ticket list's initial state.
 * Used when navigating to a ticket directly (no returnFilters in URL).
 */
export const DEFAULT_TICKET_LIST_FILTERS: ITicketListFilters = {
  statusId: TICKET_STATUS_FILTER_OPEN,
  priorityId: 'all',
  searchQuery: '',
  boardFilterState: 'active',
  showOpenOnly: true,
  bundleView: 'bundled',
  sortBy: 'entered_at',
  sortDirection: 'desc',
};

/**
 * URL pseudo-value for "tickets with no assignee". The list models unassigned
 * with the `includeUnassigned` boolean, so this sentinel is translated at the
 * serialization boundary rather than stored as a fake user id.
 */
export const UNASSIGNED_FILTER_SENTINEL = 'unassigned';

const ASSIGNEE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize the `assignedToIds` CSV URL token into assignee ids the list query
 * can trust.
 *
 * The list serializes the assignee filter as a comma-separated list, but a URL
 * is a public boundary — it can be hand-edited, stale, or shared — and any
 * token that is not an assignee id used to reach ticketListFiltersSchema's
 * `z.string().guid()` and throw, blanking the list. Parsing here means the
 * schema only ever sees well-formed ids. The `unassigned` pseudo-value is
 * translated to the `includeUnassigned` boolean the list already uses for
 * "no assignee" instead of being dropped.
 */
export function normalizeAssignedToIds(raw: string | null | undefined): {
  assignedToIds?: string[];
  includeUnassigned?: boolean;
} {
  if (!raw) return {};

  const assignedToIds: string[] = [];
  let includeUnassigned = false;

  for (const token of raw.split(',')) {
    const value = token.trim();
    if (value.length === 0) continue;
    if (value === UNASSIGNED_FILTER_SENTINEL) {
      includeUnassigned = true;
    } else if (ASSIGNEE_UUID_PATTERN.test(value) && !assignedToIds.includes(value)) {
      assignedToIds.push(value);
    }
  }

  return {
    assignedToIds: assignedToIds.length > 0 ? assignedToIds : undefined,
    includeUnassigned: includeUnassigned || undefined,
  };
}

/**
 * Normalize a stored/list-shaped `assignedToIds` array.
 *
 * Stored board/tenant views accept arbitrary strings — a hand-written or older
 * document can hold anything — and on the SSR remembered-board path the
 * known-user universe is not loaded, so membership validation cannot remove
 * them. The UUID-only ticket-list schema then rejects the whole request and the
 * board fails to load. Shape-validate here: keep valid UUIDs, deduplicate, and
 * drop everything else (including the `unassigned` URL sentinel, which the list
 * models with `includeUnassigned`). Returns `undefined` when nothing survives,
 * so callers omit the key rather than forwarding an empty list.
 */
export function normalizeAssignedToIdList(
  values: readonly string[] | null | undefined,
): string[] | undefined {
  if (!values || values.length === 0) return undefined;

  const normalized: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value === UNASSIGNED_FILTER_SENTINEL) continue;
    if (ASSIGNEE_UUID_PATTERN.test(value) && !normalized.includes(value)) {
      normalized.push(value);
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

/** Whether a client row lets a ticket with this client through. No row allows everyone. */
export function clientRowAllows(selection: WhereSelection | null | undefined, clientId: string | null | undefined): boolean {
  if (!selection || selection.ids.length === 0) return true;
  const listed = !!clientId && selection.ids.includes(clientId);
  return selection.mode === 'in' ? listed : !listed;
}

/**
 * The combined client+contact filter update a change to the client row produces.
 *
 * The two filters are cross-linked: a contact whose client the client row forbids would be an
 * impossible-by-construction combination that silently empties the list. Clearing it is the only
 * honest outcome, and clearing it here, as one update rather than a follow-up, keeps the change to a
 * single debounced fetch with no intermediate state where the stale contact still applies.
 *
 * Keeping rules, in order:
 * - no contact selected → nothing to decide;
 * - no client row (cleared, or never set) → every contact is reachable, so the contact stands;
 * - the row allows the contact's client (`in`: listed; `not_in`: not listed) → it stands;
 * - anything else, *including unknown ownership* → cleared. Unknown means the contact is not in the
 *   loaded option list, which is precisely the evidence that the row does not reach it.
 *
 * The returned `clientId: undefined` retires the legacy single-client key in the same update, so a
 * stale `clientId` can never survive next to the row that replaced it.
 */
export function contactFilterUpdateForClientChange(params: {
  /** The `where` before the change; clauses other than the client row are kept. */
  currentWhere: PredicateGroup | undefined;
  /** The client row after the change; null / empty = no client row. */
  nextSelection: WhereSelection | null | undefined;
  /** The contact filter currently applied, if any. */
  currentContactId: string | null | undefined;
  /** The client the current contact belongs to, when known. */
  contactClientId?: string | null;
}): { where: PredicateGroup | undefined; clientId: undefined; contactId?: string } {
  const selection = params.nextSelection && params.nextSelection.ids.length > 0 ? params.nextSelection : null;
  const where = setWhereTagSelection(params.currentWhere, 'client.id', selection);
  const contactId = params.currentContactId || undefined;

  if (!contactId || !selection) return { where, clientId: undefined, contactId };
  return {
    where,
    clientId: undefined,
    contactId: clientRowAllows(selection, params.contactClientId) ? contactId : undefined,
  };
}

/**
 * Folds a legacy `clientId` into the `client.id` where row. A URL is a v2 filter document, so this
 * is the v2→v3 step of `migrateTicketFilters` itself (the one fold) rather than a second copy of it.
 */
export function foldLegacyClientId<T extends Partial<ITicketListFilters>>(filters: T): T {
  return (migrateTicketFilters(filters as Record<string, unknown>, 2) ?? filters) as T;
}

/**
 * Parse a returnFilters query string (from the ticket detail URL) back into
 * ITicketListFilters with proper defaults applied.
 *
 * The returnFilters string is produced by getCurrentFiltersQuery() in
 * TicketingDashboard and by updateURLWithFilters() in TicketingDashboardContainer.
 * Only non-default values are encoded, so we must apply defaults for missing keys.
 */
export function parseReturnFilters(returnFiltersEncoded: string): ITicketListFilters {
  const decoded = decodeURIComponent(returnFiltersEncoded);
  const params = new URLSearchParams(decoded);

  const statusId = params.get('statusId') || TICKET_STATUS_FILTER_OPEN;
  const assignedTo = normalizeAssignedToIds(params.get('assignedToIds'));

  return foldLegacyClientId({
    boardId: params.get('boardId') || undefined,
    boardIds: params.get('boardIds') ? params.get('boardIds')!.split(',').filter(Boolean) : undefined,
    excludeBoardIds: params.get('excludeBoardIds') ? params.get('excludeBoardIds')!.split(',').filter(Boolean) : undefined,
    statusId,
    priorityId: params.get('priorityId') || 'all',
    categoryId: params.get('categoryId') || undefined,
    categoryIds: params.get('categoryIds') ? params.get('categoryIds')!.split(',').filter(Boolean) : undefined,
    excludeCategoryIds: params.get('excludeCategoryIds') ? params.get('excludeCategoryIds')!.split(',').filter(Boolean) : undefined,
    clientId: params.get('clientId') || undefined,
    contactId: params.get('contactId') || undefined,
    searchQuery: params.get('searchQuery') || '',
    boardFilterState: (params.get('boardFilterState') as 'active' | 'inactive' | 'all') || 'active',
    showOpenOnly: isTicketStatusOpenFilter(statusId),
    tags: params.get('tags') ? params.get('tags')!.split(',').map(t => decodeURIComponent(t)) : undefined,
    assignedToIds: assignedTo.assignedToIds,
    assignedTeamIds: params.get('assignedTeamIds') ? params.get('assignedTeamIds')!.split(',') : undefined,
    includeUnassigned: params.get('includeUnassigned') === 'true' || assignedTo.includeUnassigned || undefined,
    dueDateFilter: (params.get('dueDateFilter') as ITicketListFilters['dueDateFilter']) || undefined,
    dueDateFrom: params.get('dueDateFrom') || undefined,
    dueDateTo: params.get('dueDateTo') || undefined,
    responseState: (params.get('responseState') as ITicketListFilters['responseState']) || undefined,
    slaStatusFilter: (params.get('slaStatusFilter') as ITicketListFilters['slaStatusFilter']) || undefined,
    sortBy: params.get('sortBy') || 'entered_at',
    sortDirection: (params.get('sortDirection') as 'asc' | 'desc') || 'desc',
    bundleView: (params.get('bundleView') as 'bundled' | 'individual') || 'bundled',
    where: decodeTicketWhere(params.get('where')).where,
  });
}
