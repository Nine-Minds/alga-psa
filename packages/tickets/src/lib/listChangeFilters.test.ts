import { describe, expect, it } from 'vitest';
import { classifyTicketListChange, matchesTicketListChange, recordTicketListChange, type TicketListChange } from './listChangeFilters';

const base: TicketListChange = {
  ticketId: 't-1', changeKind: 'created', boardId: 'b-1', statusId: '00000000-0000-4000-8000-000000000001', statusIsClosed: false,
  assigneeIds: ['u-2'], searchText: 'printer offline', actorUserId: 'u-3', updatedAt: '2026-01-01T00:01:00Z',
  isBoardActive: true,
};

describe('ticket list live change classification', () => {
  it('classifies snapshot membership before filter matching and rejects own/stale events', () => {
    const loadedTicketIds = new Set(['t-1']);
    expect(classifyTicketListChange({ change: base, loadedTicketIds, filters: { boardId: 'wrong' }, currentUserId: 'u-4', loadedAt: 0 })).toBe('updated');
    expect(classifyTicketListChange({ change: base, loadedTicketIds: new Set(), filters: {}, currentUserId: 'u-3', loadedAt: 0 })).toBe('ignore');
    expect(classifyTicketListChange({ change: { ...base, updatedAt: '1970-01-01T00:00:00Z' }, loadedTicketIds: new Set(), filters: {}, currentUserId: 'u-4', loadedAt: 0 })).toBe('ignore');
    expect(classifyTicketListChange({ change: { ...base, changeKind: 'updated' }, loadedTicketIds: new Set(), filters: {}, currentUserId: 'u-4', loadedAt: 0 })).toBe('new');
    expect(classifyTicketListChange({ change: { ...base, changeKind: 'updated' }, loadedTicketIds: new Set(), filters: {}, currentUserId: 'u-4', loadedAt: 0 })).toBe('new');
  });

  it('applies board, status, assignee and search predicates, and fails closed on missing metadata', () => {
    expect(matchesTicketListChange(base, { boardIds: ['b-1'], statusId: '00000000-0000-4000-8000-000000000001', assignedToIds: ['u-2'] })).toBe(true);
    expect(matchesTicketListChange(base, { searchQuery: 'network' })).toBe(null);
    expect(matchesTicketListChange({ ...base, statusId: null }, {})).toBe(null);
  });

  it('fails closed when an active filter needs metadata absent from the event', () => {
    expect(matchesTicketListChange(base, { clientId: 'client-1' })).toBe(null);
    expect(matchesTicketListChange(base, { where: { clauses: [{ field: 'priority_id', operator: 'eq', value: 'p1' }] } as any })).toBe(null);
  });

  it('evaluates due-date, assignee OR/unassigned, and advanced predicate filters', () => {
    const now = Date.now();
    const enriched = { ...base, dueDate: new Date(now + 60_000).toISOString(), primaryAssigneeId: null,
      assigneeIds: [], filterRecord: { priority_id: 'p-1', status_id: 's-open' } };
    expect(matchesTicketListChange(enriched, { dueDateFilter: 'upcoming' })).toBe(true);
    expect(matchesTicketListChange({ ...enriched, dueDate: new Date(now - 60_000).toISOString() }, { dueDateFilter: 'upcoming' })).toBe(false);
    expect(matchesTicketListChange(enriched, { assignedToIds: ['u-2'], includeUnassigned: true })).toBe(true);
    expect(matchesTicketListChange({ ...enriched, primaryAssigneeId: 'u-9', assigneeIds: ['u-9'] }, { assignedToIds: ['u-2'], includeUnassigned: true })).toBe(false);
    expect(matchesTicketListChange(enriched, { where: { join: 'and', clauses: [{ path: 'priority_id', operator: 'equals', value: 'p-1' }] } })).toBe(true);
    expect(matchesTicketListChange(enriched, { where: { join: 'and', clauses: [{ path: 'priority_id', operator: 'equals', value: 'p-2' }] } })).toBe(false);
  });

  it('matches no-board and no-category selectors with the list query sentinel semantics', () => {
    expect(matchesTicketListChange({ ...base, boardId: null, categoryIds: [] }, { boardId: 'no-board' })).toBe(true);
    expect(matchesTicketListChange(base, { boardId: 'no-board' })).toBe(false);
    expect(matchesTicketListChange({ ...base, categoryIds: [] }, { categoryId: 'all' })).toBe(true);
    expect(matchesTicketListChange({ ...base, categoryIds: [] }, { categoryIds: ['no-category', 'category-a'] })).toBe(true);
    expect(matchesTicketListChange({ ...base, categoryIds: ['category-a'] }, { excludeCategoryIds: ['no-category'] })).toBe(true);
  });


  it('deduplicates ticket events and preserves a new ticket classification across later edits', () => {
    const first = recordTicketListChange(new Map(), 't-1', 'new', { kind: 'new', timestamp: 1 });
    const second = recordTicketListChange(first, 't-1', 'updated', { kind: 'updated', timestamp: 2 });
    expect(second.size).toBe(1);
    expect(second.get('t-1')).toEqual({ kind: 'new', timestamp: 1 });
  });
  it('uses list-query precedence and sentinel rules instead of intersecting legacy filters', () => {
    expect(matchesTicketListChange(base, { boardId: 'old-board', boardIds: ['b-1'] })).toBe(true);
    expect(matchesTicketListChange({ ...base, categoryIds: [] }, { excludeCategoryIds: ['no-category'] })).toBe(false);
    expect(matchesTicketListChange(base, { statusId: 'closed', showOpenOnly: false })).toBe(true);
    expect(matchesTicketListChange(base, { dueDateFilter: 'all', dueDateFrom: '2099-01-01' })).toBe(true);
    expect(matchesTicketListChange({ ...base, tags: ['urgent'], ticketTagIdsByText: { urgent: 'tag-id' },
      filterRecord: { tags: ['tag-id'] } }, { tags: ['urgent'] })).toBe(true);
  });

});
