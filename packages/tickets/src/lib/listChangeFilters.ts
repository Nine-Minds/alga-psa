import type { ITicketListFilters } from '@alga-psa/types';
import { evaluatePredicate, isPredicateGroup, readPath, type PredicateNode } from '@alga-psa/predicates';
import { parseTicketStatusFilterValue, shouldApplyOpenOnlyStatusFilter } from './ticketStatusFilter';
import { todayRange } from './ticketFilterPredicates';

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
  const hasBoardFilter = Boolean(filters.boardId || filters.boardIds?.length || filters.excludeBoardIds?.length);
  if (filters.boardId === 'no-board' && change.boardId !== null) return false;
  if (hasBoardFilter && change.boardId === null && !filters.boardIds?.includes('no-board') && filters.boardId !== 'no-board') return false;
  if (filters.boardId && filters.boardId !== 'no-board' && filters.boardId !== change.boardId) return false;
  if (filters.boardIds?.length && !filters.boardIds.includes(change.boardId ?? 'no-board')) return false;
  if (filters.excludeBoardIds?.includes(change.boardId ?? 'no-board')) return false;
  const status = parseTicketStatusFilterValue(filters.statusId);
  if (shouldApplyOpenOnlyStatusFilter(filters.statusId, filters.showOpenOnly)) {
    if (change.statusIsClosed === undefined) return null;
    if (change.statusIsClosed) return false;
  } else if (status.kind === 'closed') {
    if (change.statusIsClosed === undefined) return null;
    if (!change.statusIsClosed) return false;
  } else if (status.kind === 'id' && status.statusId !== change.statusId) return false;
  else if (status.kind === 'name') {
    if (change.statusName === undefined) return null;
    if (change.statusName !== status.statusName) return false;
  }
  const hasAssignmentFilter = Boolean(filters.assignedToIds?.length || filters.assignedTeamIds?.length || filters.includeUnassigned);
  if (hasAssignmentFilter) {
    if (filters.assignedTeamIds?.length && !change.teamIds) return null;
    const assignedMatch = Boolean(filters.assignedToIds?.some(id => change.assigneeIds.includes(id)) || filters.assignedTeamIds?.some(id => change.teamIds?.includes(id)));
    const unassignedMatch = Boolean(filters.includeUnassigned && change.primaryAssigneeId === null);
    if (!assignedMatch && !unassignedMatch) return false;
  }
  if (filters.priorityId && filters.priorityId !== 'all' && change.priorityId == null) return null;
  if (filters.priorityId && filters.priorityId !== 'all' && change.priorityId !== filters.priorityId) return false;
  const rawCategories = filters.categoryIds?.length ? filters.categoryIds : filters.categoryId && filters.categoryId !== 'all' ? [filters.categoryId] : [];
  const includeNoCategory = rawCategories.includes('no-category');
  const categories = rawCategories.filter(id => id !== 'no-category' && id !== 'all');
  if ((categories.length || filters.excludeCategoryIds?.length) && !change.categoryIds) return null;
  if (rawCategories.length && !((includeNoCategory && change.categoryIds?.length === 0) || categories.some(id => change.categoryIds?.includes(id)))) return false;
  if (filters.excludeCategoryIds?.includes('no-category') && change.categoryIds?.length) return false;
  if (filters.excludeCategoryIds?.some(id => id !== 'no-category' && change.categoryIds?.includes(id))) return false;
  if (filters.clientId && change.clientId == null || filters.contactId && change.contactId == null) return null;
  if (filters.clientId && filters.clientId !== change.clientId || filters.contactId && filters.contactId !== change.contactId) return false;
  if (filters.tags?.length && !change.tags) return null;
  if (filters.tags?.length && !filters.tags.some(tag => change.tags?.includes(tag))) return false;
  if (filters.assignedToMe && !change.assignedToMeBypass && change.involvedUserIds === undefined) return null;
  if (filters.assignedToMe && !change.assignedToMeBypass && !change.involvedUserIds?.includes(currentUserId)) return false;
  if (filters.bundleView === 'bundled' && change.masterTicketId === undefined) return null;
  if (filters.bundleView === 'bundled' && change.masterTicketId) return false;
  if (filters.dueDateFilter && filters.dueDateFilter !== 'all' && change.dueDate === undefined) return null;
  if (filters.dueDateFilter && filters.dueDateFilter !== 'all' && change.dueDate !== undefined) {
    const due = change.dueDate ? Date.parse(change.dueDate) : null;
    const now = Date.now();
    switch (filters.dueDateFilter) {
      case 'overdue': if (due === null || due >= now) return false; break;
      case 'upcoming': if (due === null || due < now || due > now + 7 * 24 * 60 * 60 * 1000) return false; break;
      case 'today': {
        if (due === null) return false;
        const range = todayRange(new Date(now).toISOString(), change.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
        if (due < Date.parse(range.startIso) || due >= Date.parse(range.endIso)) return false;
        break;
      }
      case 'no_due_date': if (due !== null) return false; break;
      case 'before': if (filters.dueDateTo && (due === null || due >= Date.parse(filters.dueDateTo))) return false; break;
      case 'after': if (filters.dueDateFrom && (due === null || due <= Date.parse(filters.dueDateFrom))) return false; break;
      case 'custom':
        if (filters.dueDateFrom && (due === null || due < Date.parse(filters.dueDateFrom))) return false;
        if (filters.dueDateTo && (due === null || due > Date.parse(filters.dueDateTo))) return false;
        break;
    }
  }
  if (filters.dueDateFrom || filters.dueDateTo) {
    if (change.dueDate === undefined) return null;
    if (!change.dueDate || filters.dueDateFrom && change.dueDate < filters.dueDateFrom || filters.dueDateTo && change.dueDate > filters.dueDateTo) return false;
  }
  if (filters.responseState && filters.responseState !== 'all' && change.responseState == null) return null;
  if (filters.responseState && filters.responseState !== 'all' && filters.responseState !== change.responseState) return false;
  if (filters.slaStatusFilter && filters.slaStatusFilter !== 'all' && change.slaStatus === undefined) return null;
  if (filters.slaStatusFilter === 'has_sla' && !['on_track', 'breached', 'paused'].includes(change.slaStatus ?? '')) return false;
  if (filters.slaStatusFilter === 'no_sla' && change.slaStatus !== 'no_sla') return false;
  if (filters.slaStatusFilter === 'on_track' && change.slaStatus !== 'on_track') return false;
  if (filters.slaStatusFilter === 'breached' && change.slaStatus !== 'breached') return false;
  if (filters.slaStatusFilter === 'paused' && change.slaStatus !== 'paused') return false;
  if (filters.boardFilterState !== 'all' && !filters.boardIds?.length && !filters.boardId && change.isBoardActive === undefined) return null;
  if (!filters.boardIds?.length && !filters.boardId && (filters.boardFilterState === 'active' && !change.isBoardActive || filters.boardFilterState === 'inactive' && change.isBoardActive)) return false;
  if (filters.where?.clauses?.length) {
    if (!change.filterRecord) return null;
    const hasUnknownPath = (node: PredicateNode): boolean => {
      if (isPredicateGroup(node)) return node.clauses.some(child => hasUnknownPath(child));
      return readPath(change.filterRecord, node.path) === undefined;
    };
    if (hasUnknownPath(filters.where)) return null;
    // Advanced fields are evaluated from the same authorized record enrichment
    // the relay uses, rather than treating every nonempty predicate as unknown.
    if (!evaluatePredicate(filters.where, change.filterRecord)) return false;
  }
  const query = filters.searchQuery?.trim().toLocaleLowerCase();
  if (query && !change.searchText.toLocaleLowerCase().includes(query)) return false;
  return true;
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

