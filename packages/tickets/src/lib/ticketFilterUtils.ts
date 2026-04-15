import type { ITicketListFilters } from '@alga-psa/types';
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

  return {
    boardId: params.get('boardId') || undefined,
    statusId,
    priorityId: params.get('priorityId') || 'all',
    categoryId: params.get('categoryId') || undefined,
    clientId: params.get('clientId') || undefined,
    contactId: params.get('contactId') || undefined,
    searchQuery: params.get('searchQuery') || '',
    boardFilterState: (params.get('boardFilterState') as 'active' | 'inactive' | 'all') || 'active',
    showOpenOnly: isTicketStatusOpenFilter(statusId),
    tags: params.get('tags') ? params.get('tags')!.split(',').map(t => decodeURIComponent(t)) : undefined,
    assignedToIds: params.get('assignedToIds') ? params.get('assignedToIds')!.split(',') : undefined,
    assignedTeamIds: params.get('assignedTeamIds') ? params.get('assignedTeamIds')!.split(',') : undefined,
    includeUnassigned: params.get('includeUnassigned') === 'true' || undefined,
    dueDateFilter: (params.get('dueDateFilter') as ITicketListFilters['dueDateFilter']) || undefined,
    dueDateFrom: params.get('dueDateFrom') || undefined,
    dueDateTo: params.get('dueDateTo') || undefined,
    responseState: (params.get('responseState') as ITicketListFilters['responseState']) || undefined,
    slaStatusFilter: (params.get('slaStatusFilter') as ITicketListFilters['slaStatusFilter']) || undefined,
    sortBy: params.get('sortBy') || 'entered_at',
    sortDirection: (params.get('sortDirection') as 'asc' | 'desc') || 'desc',
    bundleView: (params.get('bundleView') as 'bundled' | 'individual') || 'bundled',
  };
}
