import { describe, expect, it } from 'vitest';
import { validatePredicate } from '@alga-psa/predicates';
import type { PredicateClause, PredicateGroup } from '@alga-psa/predicates';
import type { ITicketListFilters } from '@alga-psa/types';
import { ticketFiltersToPredicates, todayRange, type TicketFilterCodecContext } from './ticketFilterPredicates';
import { ticketQuerySchema } from './ticketQuerySchema';
import { TICKET_STATUS_FILTER_ALL, createTicketStatusNameFilterValue } from './ticketStatusFilter';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-25T10:30:00.000Z';
const context = (overrides: Partial<TicketFilterCodecContext> = {}): TicketFilterCodecContext => ({
  nowIso: NOW,
  timeZone: 'UTC',
  userId: U(99),
  assignedToMeBypass: false,
  ticketTagIdsByText: {},
  ...overrides,
});
const base: ITicketListFilters = { boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false };
const encode = (filters: Partial<ITicketListFilters>, ctx = context()): PredicateGroup =>
  ticketFiltersToPredicates({ ...base, ...filters }, ctx);
const clauses = (group: PredicateGroup) => group.clauses as Array<PredicateClause | PredicateGroup>;

describe('ticketFiltersToPredicates (T012)', () => {
  it('emits nothing for an unfiltered list', () => {
    expect(clauses(encode({}))).toEqual([]);
  });

  it('adds master_ticket_id is_empty in the bundled view only', () => {
    expect(clauses(encode({ bundleView: 'bundled' }))).toEqual([{ path: 'master_ticket_id', operator: 'is_empty' }]);
    expect(clauses(encode({ bundleView: 'individual' }))).toEqual([]);
  });

  it('resolves legacy tag text to definition ids and drops unknown text', () => {
    const ctx = context({ ticketTagIdsByText: { urgent: U(1), later: U(2) } });
    expect(clauses(encode({ tags: ['urgent', 'later', 'nope'] }, ctx))).toEqual([
      { path: 'tags', operator: 'in', value: [U(1), U(2)] },
    ]);
    expect(clauses(encode({ tags: ['nope'] }, ctx))).toEqual([{ path: 'tags', operator: 'in', value: [] }]);
  });

  it('maps boards: include with sentinel, exclude, state, and the explicit-selection precedence', () => {
    expect(clauses(encode({ boardIds: [U(1), 'no-board'] }))).toEqual([
      { join: 'or', clauses: [{ path: 'board_id', operator: 'is_empty' }, { path: 'board_id', operator: 'in', value: [U(1)] }] },
    ]);
    expect(clauses(encode({ boardId: U(1) }))).toEqual([{ path: 'board_id', operator: 'in', value: [U(1)] }]);
    expect(clauses(encode({ boardIds: [U(1)], boardFilterState: 'inactive' }))).toEqual([
      { path: 'board_id', operator: 'in', value: [U(1)] },
    ]);
    expect(clauses(encode({ boardFilterState: 'inactive' }))).toEqual([{ path: 'board_inactive', operator: 'equals', value: true }]);
    expect(clauses(encode({ excludeBoardIds: ['no-board', U(2)] }))).toEqual([
      { path: 'board_id', operator: 'is_not_empty' },
      { path: 'board_id', operator: 'not_in', value: [U(2)] },
    ]);
  });

  it('maps status: open-only, by name, by id; closed and all never restrict', () => {
    expect(clauses(encode({ statusId: undefined, showOpenOnly: true }))).toEqual([{ path: 'status_closed', operator: 'equals', value: false }]);
    expect(clauses(encode({ statusId: createTicketStatusNameFilterValue('In Progress') }))).toEqual([
      { path: 'status_name', operator: 'equals', value: 'In Progress' },
    ]);
    expect(clauses(encode({ statusId: U(5) }))).toEqual([{ path: 'status_id', operator: 'equals', value: U(5) }]);
    expect(clauses(encode({ statusId: '__status_filter__:closed' }))).toEqual([]);
  });

  it('maps categories through the category attribute and the no-category sentinel', () => {
    expect(clauses(encode({ categoryIds: [U(1), 'no-category'] }))).toEqual([
      { join: 'or', clauses: [{ path: 'category_id', operator: 'is_empty' }, { path: 'category', operator: 'in', value: [U(1)] }] },
    ]);
    expect(clauses(encode({ excludeCategoryIds: [U(1), 'no-category'] }))).toEqual([
      { path: 'category_id', operator: 'is_not_empty' },
      { path: 'category', operator: 'not_in', value: [U(1)] },
    ]);
  });

  it('maps assignee, team and unassigned into one OR group', () => {
    expect(clauses(encode({ assignedToIds: [U(1)], assignedTeamIds: [U(2)], includeUnassigned: true }))).toEqual([
      {
        join: 'or',
        clauses: [
          { path: 'assigned_to', operator: 'in', value: [U(1)] },
          { path: 'assigned_team_id', operator: 'in', value: [U(2)] },
          { path: 'assigned_to', operator: 'is_empty' },
        ],
      },
    ]);
  });

  it('maps assignedToMe to the caller, and drops it when the caller holds project:read', () => {
    expect(clauses(encode({ assignedToMe: true }))).toEqual([{ path: 'involves_user', operator: 'equals', value: U(99) }]);
    expect(clauses(encode({ assignedToMe: true }, context({ assignedToMeBypass: true })))).toEqual([]);
  });

  it('turns due-date presets into absolute ranges (today in the caller zone)', () => {
    expect(clauses(encode({ dueDateFilter: 'overdue' }))).toEqual([{ path: 'due_date', operator: 'lt', value: NOW }]);
    expect(clauses(encode({ dueDateFilter: 'upcoming' }))).toEqual([
      { path: 'due_date', operator: 'gte', value: NOW },
      { path: 'due_date', operator: 'lte', value: '2026-11-01T10:30:00Z' },
    ]);
    expect(clauses(encode({ dueDateFilter: 'no_due_date' }))).toEqual([{ path: 'due_date', operator: 'is_empty' }]);
    expect(clauses(encode({ dueDateFilter: 'before' }))).toEqual([]);
    expect(clauses(encode({ dueDateFilter: 'custom', dueDateFrom: '2026-10-01T00:00:00Z', dueDateTo: '2026-10-02T00:00:00Z' }))).toEqual([
      { path: 'due_date', operator: 'gte', value: '2026-10-01T00:00:00Z' },
      { path: 'due_date', operator: 'lte', value: '2026-10-02T00:00:00Z' },
    ]);
    expect(todayRange(NOW, 'UTC')).toEqual({ startIso: '2026-10-25T00:00:00Z', endIso: '2026-10-26T00:00:00Z' });
    // 10:30Z is already the next morning in Auckland (UTC+13): "today" there starts 2026-10-24T11:00Z.
    expect(todayRange(NOW, 'Pacific/Auckland')).toEqual({ startIso: '2026-10-24T11:00:00Z', endIso: '2026-10-25T11:00:00Z' });
  });

  it('maps response state and SLA keys', () => {
    expect(clauses(encode({ responseState: 'none' }))).toEqual([{ path: 'response_state', operator: 'is_empty' }]);
    expect(clauses(encode({ responseState: 'awaiting_client' }))).toEqual([{ path: 'response_state', operator: 'equals', value: 'awaiting_client' }]);
    expect(clauses(encode({ slaStatusFilter: 'has_sla' }))).toEqual([{ path: 'sla_policy_id', operator: 'is_not_empty' }]);
    expect(clauses(encode({ slaStatusFilter: 'no_sla' }))).toEqual([{ path: 'sla_policy_id', operator: 'is_empty' }]);
    expect(clauses(encode({ slaStatusFilter: 'breached' }))).toEqual([{ path: 'sla_state', operator: 'equals', value: 'breached' }]);
  });

  it('maps client and contact to relation paths', () => {
    expect(clauses(encode({ clientId: U(1), contactId: U(2) }))).toEqual([
      { path: 'client.id', operator: 'equals', value: U(1) },
      { path: 'contact.id', operator: 'equals', value: U(2) },
    ]);
  });

  it('every legacy key produces a group that is valid against the ticket query schema', () => {
    const everything = encode(
      {
        bundleView: 'bundled',
        boardIds: [U(1), 'no-board'],
        excludeBoardIds: [U(2), 'no-board'],
        statusId: U(3),
        priorityId: U(4),
        categoryIds: [U(5), 'no-category'],
        excludeCategoryIds: [U(6), 'no-category'],
        clientId: U(7),
        contactId: U(8),
        tags: ['urgent'],
        assignedToIds: [U(9)],
        assignedTeamIds: [U(10)],
        includeUnassigned: true,
        assignedToMe: true,
        dueDateFilter: 'custom',
        dueDateFrom: '2026-10-01T00:00:00Z',
        dueDateTo: '2026-10-02T00:00:00Z',
        responseState: 'awaiting_internal',
        slaStatusFilter: 'on_track',
      },
      context({ ticketTagIdsByText: { urgent: U(11) } }),
    );
    expect(validatePredicate(ticketQuerySchema, everything)).toEqual([]);
  });
});
