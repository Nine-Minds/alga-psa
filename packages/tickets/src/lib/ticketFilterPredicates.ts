/**
 * Codec from the legacy `ITicketListFilters` keys to a predicate group over the ticket query schema.
 * The legacy keys stay as the wire format of URLs, the toolbar and old stored views; new dimensions
 * are predicates only (`filters.where`). `buildTicketListBaseQuery` compiles this group (plus
 * `filters.where`) and contains no hand-written filter SQL of its own.
 */
import { Temporal } from '@js-temporal/polyfill';
import type { PredicateClause, PredicateGroup } from '@alga-psa/predicates';
import type { ITicketListFilters } from '@alga-psa/types';
import { shouldApplyOpenOnlyStatusFilter, parseTicketStatusFilterValue } from './ticketStatusFilter';

export interface TicketFilterCodecContext {
  /** Current instant (ISO). Injected so tests can pin the clock. */
  nowIso: string;
  /** IANA zone for the "today" due-date preset. */
  timeZone: string;
  /** The caller's user id (for `assignedToMe`). */
  userId: string;
  /** True when the caller holds `project:read`; `assignedToMe` is then a no-op, as before. */
  assignedToMeBypass: boolean;
  /** Ticket tag definition ids by tag text, for the legacy `tags` key. Unknown texts are absent. */
  ticketTagIdsByText: Record<string, string>;
}

const clause = (path: string, operator: PredicateClause['operator'], value?: PredicateClause['value']): PredicateClause =>
  value === undefined ? { path, operator } : { path, operator, value };

const or = (clauses: PredicateGroup['clauses']): PredicateGroup => ({ join: 'or', clauses });

/** Resolves the `today` preset into [start, end) for the zone. */
export function todayRange(nowIso: string, timeZone: string): { startIso: string; endIso: string } {
  const zonedNow = Temporal.Instant.from(nowIso).toZonedDateTimeISO(timeZone);
  const start = zonedNow.startOfDay();
  return { startIso: start.toInstant().toString(), endIso: start.add({ days: 1 }).toInstant().toString() };
}

export function ticketFiltersToPredicates(
  filters: ITicketListFilters,
  context: TicketFilterCodecContext,
): PredicateGroup {
  const all: PredicateGroup['clauses'] = [];

  if (filters.bundleView === 'bundled') {
    all.push(clause('master_ticket_id', 'is_empty'));
  }

  // Board include. The multi-select wins over the legacy single id; an explicit selection takes
  // precedence over the active/inactive restriction.
  const includeBoardIds = filters.boardIds?.length ? filters.boardIds : filters.boardId ? [filters.boardId] : [];
  if (includeBoardIds.length > 0) {
    const real = includeBoardIds.filter((id) => id !== 'no-board');
    const parts: PredicateGroup['clauses'] = [];
    if (includeBoardIds.includes('no-board')) parts.push(clause('board_id', 'is_empty'));
    if (real.length > 0) parts.push(clause('board_id', 'in', real));
    all.push(parts.length === 1 ? parts[0] : or(parts));
  } else if (filters.boardFilterState !== 'all') {
    all.push(clause('board_inactive', 'equals', filters.boardFilterState === 'inactive'));
  }

  const excludeBoardIds = filters.excludeBoardIds ?? [];
  if (excludeBoardIds.includes('no-board')) all.push(clause('board_id', 'is_not_empty'));
  const excludeRealBoards = excludeBoardIds.filter((id) => id !== 'no-board');
  if (excludeRealBoards.length > 0) all.push(clause('board_id', 'not_in', excludeRealBoards));

  // Status. Bare "closed"/"all" sentinels never restricted the list; that is kept.
  const parsedStatus = parseTicketStatusFilterValue(filters.statusId);
  if (shouldApplyOpenOnlyStatusFilter(filters.statusId, filters.showOpenOnly)) {
    all.push(clause('status_closed', 'equals', false));
  } else if (parsedStatus.kind === 'name') {
    all.push(clause('status_name', 'equals', parsedStatus.statusName));
  } else if (parsedStatus.kind === 'id') {
    all.push(clause('status_id', 'equals', parsedStatus.statusId));
  }

  if (filters.priorityId && filters.priorityId !== 'all') {
    all.push(clause('priority_id', 'equals', filters.priorityId));
  }

  // Category include/exclude: a ticket "has" a category through category_id or subcategory_id.
  const includeCategoryIds = filters.categoryIds?.length
    ? filters.categoryIds
    : filters.categoryId && filters.categoryId !== 'all'
      ? [filters.categoryId]
      : [];
  const includeNoCategory = includeCategoryIds.includes('no-category');
  const includeRealCategories = includeCategoryIds.filter((id) => id !== 'no-category' && id !== 'all');
  if (includeNoCategory || includeRealCategories.length > 0) {
    const parts: PredicateGroup['clauses'] = [];
    if (includeNoCategory) parts.push(clause('category_id', 'is_empty'));
    if (includeRealCategories.length > 0) parts.push(clause('category', 'in', includeRealCategories));
    all.push(parts.length === 1 ? parts[0] : or(parts));
  }
  const excludeCategoryIds = filters.excludeCategoryIds ?? [];
  if (excludeCategoryIds.includes('no-category')) all.push(clause('category_id', 'is_not_empty'));
  const excludeRealCategories = excludeCategoryIds.filter((id) => id !== 'no-category' && id !== 'all');
  if (excludeRealCategories.length > 0) all.push(clause('category', 'not_in', excludeRealCategories));

  if (filters.clientId) all.push(clause('client.id', 'equals', filters.clientId));
  if (filters.contactId) all.push(clause('contact.id', 'equals', filters.contactId));

  // Legacy ticket tags are tag text; the model keys on the definition id. Unknown text matches nothing.
  if (filters.tags && filters.tags.length > 0) {
    const ids = filters.tags
      .map((text) => context.ticketTagIdsByText[text])
      .filter((id): id is string => typeof id === 'string');
    all.push(clause('tags', 'in', Array.from(new Set(ids))));
  }

  // Assignee / team / unassigned are one OR group.
  const assigneeParts: PredicateGroup['clauses'] = [];
  if (filters.assignedToIds?.length) assigneeParts.push(clause('assigned_to', 'in', filters.assignedToIds));
  if (filters.assignedTeamIds?.length) assigneeParts.push(clause('assigned_team_id', 'in', filters.assignedTeamIds));
  if (filters.includeUnassigned) assigneeParts.push(clause('assigned_to', 'is_empty'));
  if (assigneeParts.length > 0) {
    all.push(assigneeParts.length === 1 ? assigneeParts[0] : or(assigneeParts));
  }

  if (filters.assignedToMe && !context.assignedToMeBypass) {
    all.push(clause('involves_user', 'equals', context.userId));
  }

  if (filters.dueDateFilter && filters.dueDateFilter !== 'all') {
    const now = Temporal.Instant.from(context.nowIso);
    switch (filters.dueDateFilter) {
      case 'overdue':
        all.push(clause('due_date', 'lt', context.nowIso));
        break;
      case 'upcoming':
        all.push(clause('due_date', 'gte', context.nowIso));
        all.push(clause('due_date', 'lte', now.add({ hours: 24 * 7 }).toString()));
        break;
      case 'today': {
        const { startIso, endIso } = todayRange(context.nowIso, context.timeZone);
        all.push(clause('due_date', 'gte', startIso));
        all.push(clause('due_date', 'lt', endIso));
        break;
      }
      case 'no_due_date':
        all.push(clause('due_date', 'is_empty'));
        break;
      case 'before':
        if (filters.dueDateTo) all.push(clause('due_date', 'lt', filters.dueDateTo));
        break;
      case 'after':
        if (filters.dueDateFrom) all.push(clause('due_date', 'gt', filters.dueDateFrom));
        break;
      case 'custom':
        if (filters.dueDateFrom) all.push(clause('due_date', 'gte', filters.dueDateFrom));
        if (filters.dueDateTo) all.push(clause('due_date', 'lte', filters.dueDateTo));
        break;
    }
  }

  if (filters.responseState && filters.responseState !== 'all') {
    all.push(
      filters.responseState === 'none'
        ? clause('response_state', 'is_empty')
        : clause('response_state', 'equals', filters.responseState),
    );
  }

  switch (filters.slaStatusFilter) {
    case 'has_sla':
      all.push(clause('sla_policy_id', 'is_not_empty'));
      break;
    case 'no_sla':
      all.push(clause('sla_policy_id', 'is_empty'));
      break;
    case 'on_track':
    case 'breached':
    case 'paused':
      all.push(clause('sla_state', 'equals', filters.slaStatusFilter));
      break;
  }

  return { join: 'and', clauses: all };
}
