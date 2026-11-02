import type { ITicketListFilters } from '@alga-psa/types';

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
}

/**
 * Returns null when the compact event cannot be evaluated without lying. The
 * caller should keep it out of list counts and badges in that case.
 */
export function matchesTicketListChange(
  change: TicketListChange,
  filters: Partial<ITicketListFilters>,
): boolean | null {
  if (!change.ticketId || !change.boardId || !change.statusId || !Array.isArray(change.assigneeIds)) return null;
  if (filters.boardId && filters.boardId !== change.boardId) return false;
  if (filters.boardIds?.length && !filters.boardIds.includes(change.boardId)) return false;
  if (filters.excludeBoardIds?.includes(change.boardId)) return false;
  if (filters.statusId && filters.statusId !== 'all' && filters.statusId !== change.statusId) return false;
  if (filters.assignedToIds?.length && !filters.assignedToIds.some(id => change.assigneeIds.includes(id))) return false;
  if (filters.includeUnassigned && !filters.assignedToIds?.length && change.assigneeIds.length > 0) return false;
  if (filters.assignedTeamIds?.length && !change.teamIds) return null;
  if (filters.assignedTeamIds?.length && !filters.assignedTeamIds.some(id => change.teamIds?.includes(id))) return false;
  if (filters.priorityId && filters.priorityId !== 'all' && change.priorityId == null) return null;
  if (filters.priorityId && filters.priorityId !== 'all' && change.priorityId !== filters.priorityId) return false;
  const categories = filters.categoryIds?.length ? filters.categoryIds : filters.categoryId ? [filters.categoryId] : [];
  if ((categories.length || filters.excludeCategoryIds?.length) && !change.categoryIds) return null;
  if (categories.length && !categories.some(id => change.categoryIds?.includes(id))) return false;
  if (filters.excludeCategoryIds?.some(id => change.categoryIds?.includes(id))) return false;
  if (filters.clientId && change.clientId == null || filters.contactId && change.contactId == null) return null;
  if (filters.clientId && filters.clientId !== change.clientId || filters.contactId && filters.contactId !== change.contactId) return false;
  if (filters.tags?.length && !change.tags) return null;
  if (filters.tags?.length && !filters.tags.every(tag => change.tags?.includes(tag))) return false;
  if (filters.dueDateFilter && filters.dueDateFilter !== 'all' && change.dueDate === undefined) return null;
  if (filters.dueDateFrom || filters.dueDateTo) {
    if (change.dueDate === undefined) return null;
    if (!change.dueDate || filters.dueDateFrom && change.dueDate < filters.dueDateFrom || filters.dueDateTo && change.dueDate > filters.dueDateTo) return false;
  }
  if (filters.responseState && filters.responseState !== 'all' && change.responseState == null) return null;
  if (filters.responseState && filters.responseState !== 'all' && filters.responseState !== change.responseState) return false;
  if (filters.slaStatusFilter && filters.slaStatusFilter !== 'all' && change.slaStatus == null) return null;
  if (filters.slaStatusFilter && filters.slaStatusFilter !== 'all' && filters.slaStatusFilter !== change.slaStatus) return false;
  if (filters.boardFilterState !== 'all' && change.isBoardActive === undefined) return null;
  if (filters.boardFilterState === 'active' && !change.isBoardActive || filters.boardFilterState === 'inactive' && change.isBoardActive) return false;
  if (filters.where?.clauses?.length) return null;
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
  if (change.changeKind !== 'created') return 'ignore';
  return matchesTicketListChange(change, filters) === true ? 'new' : 'ignore';
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

