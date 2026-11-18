import type { ITicketListFilters } from '@alga-psa/types';
import { evaluatePredicate, isPredicateGroup, readPath, type PredicateNode } from '@alga-psa/predicates';
import { ticketFiltersToPredicates } from './ticketFilterPredicates';

/** Fields needed to decide whether a ticket belongs in a loaded ticket list. */
export interface TicketListChange {
  ticketId: string;
  changeKind: 'created' | 'updated';
  boardId: string | null;
  statusId: string | null;
  assigneeIds: string[];
  searchText: string;
  actorUserId: string | null;
  updatedAt: string;
  /** Metadata carried for filter dimensions that are present in this list. */
  priorityId?: string | null;
  categoryIds?: string[] | null;
  clientId?: string | null;
  contactId?: string | null;
  tags?: string[] | null;
  teamIds?: string[] | null;
  dueDate?: string | null;
  responseState?: string | null;
  slaStatus?: string | null;
  isBoardActive?: boolean;
  statusIsClosed?: boolean;
  statusName?: string;
  masterTicketId?: string | null;
  /** User ids covered by assigned-to-me semantics (primary, additional or team member). */
  involvedUserIds?: string[];
  primaryAssigneeId?: string | null;
  timeZone?: string;
  assignedToMeBypass?: boolean;
  /** Authorized, filter-safe query record for active `where` predicates. */
  filterRecord?: Record<string, unknown>;
  ticketTagIdsByText?: Record<string, string>;
}

/**
 * Returns null when the compact event cannot be evaluated without lying. The
 * caller should keep it out of list counts and badges in that case.
 * For pagination, the snapshot membership set is the currently loaded page;
 * an absent id that matches these filters is classified as new by design.
 */
export function matchesTicketListChange(
  change: TicketListChange,
  filters: Partial<ITicketListFilters>,
  currentUserId = '',
): boolean | null {
  if (!change.ticketId || !change.statusId || !Array.isArray(change.assigneeIds)) return null;
  // Use the list query's codec rather than maintaining a second set of
  // board/status/assignment/date/category rules for live events.
  const record: Record<string, unknown> = {
    board_id: change.boardId,
    board_inactive: change.isBoardActive === undefined ? undefined : !change.isBoardActive,
    status_id: change.statusId,
    status_name: change.statusName,
    status_closed: change.statusIsClosed,
    assigned_to: change.primaryAssigneeId === undefined ? change.assigneeIds[0] : change.primaryAssigneeId,
    assigned_team_id: change.teamIds === undefined ? undefined : change.teamIds?.[0] ?? null,
    priority_id: change.priorityId,
    category_id: change.categoryIds === undefined ? undefined : change.categoryIds?.[0] ?? null,
    category: change.categoryIds,
    client: { id: change.clientId },
    contact: { id: change.contactId },
    tags: change.tags,
    master_ticket_id: change.masterTicketId,
    involves_user: change.involvedUserIds === undefined ? undefined : change.involvedUserIds.includes(currentUserId) ? currentUserId : null,
    due_date: change.dueDate,
    response_state: change.responseState === 'none' ? null : change.responseState,
    sla_policy_id: change.slaStatus === undefined ? undefined : change.slaStatus === 'no_sla' ? null : 'present',
    sla_state: change.slaStatus === 'no_sla' ? null : change.slaStatus,
    ...change.filterRecord,
  };
  const group = {
    join: 'and' as const,
    clauses: [ticketFiltersToPredicates(filters as ITicketListFilters, {
      nowIso: new Date().toISOString(),
      timeZone: change.timeZone || 'UTC',
      userId: currentUserId,
      assignedToMeBypass: Boolean(change.assignedToMeBypass),
      ticketTagIdsByText: change.ticketTagIdsByText ?? Object.fromEntries((change.tags ?? []).map(tag => [tag, tag])),
    }), ...(filters.where?.clauses ?? [])],
  };
  const hasUnknownPath = (node: PredicateNode): boolean => {
    if (isPredicateGroup(node)) return node.clauses.some(hasUnknownPath);
    return typeof node.path !== 'string' || readPath(record, node.path) === undefined;
  };
  if (hasUnknownPath(group)) return null;
  if (!evaluatePredicate(group, record)) return false;
  const query = filters.searchQuery?.trim().toLocaleLowerCase();
  // The list uses PostgreSQL full-text, prefix and trigram search (including
  // visible comments). A substring test cannot reproduce that membership.
  // The caller reconciles these events through the counts-only list query.
  return query ? null : true;
}

export type ListChangeClassification = 'new' | 'updated' | 'ignore';

export function classifyTicketListChange(options: {
  change: TicketListChange;
  loadedTicketIds: ReadonlySet<string>;
  filters: Partial<ITicketListFilters>;
  currentUserId: string;
  loadedAt: number;
}): ListChangeClassification {
  const { change, loadedTicketIds, filters, currentUserId, loadedAt } = options;
  if (!change.ticketId || change.actorUserId === currentUserId || Date.parse(change.updatedAt) <= loadedAt) return 'ignore';
  if (loadedTicketIds.has(change.ticketId)) return 'updated';
  return matchesTicketListChange(change, filters, currentUserId) === true ? 'new' : 'ignore';
}

/** Stable event-id-independent accumulator: one visible count per ticket. */
export function recordTicketListChange<T extends { kind: 'new' | 'updated' }>(
  changes: ReadonlyMap<string, T>, ticketId: string, kind: T['kind'], value: T,
): Map<string, T> {
  const next = new Map(changes);
  const previous = next.get(ticketId);
  // A creation can be followed by another edit while it is still absent from
  // the snapshot; it remains one new ticket rather than moving categories.
  next.set(ticketId, previous?.kind === 'new' ? previous : { ...value, kind });
  return next;
}
