import { describe, expect, it } from 'vitest';
import { classifyTicketListChange, matchesTicketListChange, recordTicketListChange, type TicketListChange } from './listChangeFilters';

const base: TicketListChange = {
  ticketId: 't-1', changeKind: 'created', boardId: 'b-1', statusId: 's-open',
  assigneeIds: ['u-2'], searchText: 'printer offline', actorUserId: 'u-3', updatedAt: '2026-01-01T00:01:00Z',
  isBoardActive: true,
};

describe('ticket list live change classification', () => {
  it('classifies snapshot membership before filter matching and rejects own/stale events', () => {
    const loadedTicketIds = new Set(['t-1']);
    expect(classifyTicketListChange({ change: base, loadedTicketIds, filters: { boardId: 'wrong' }, currentUserId: 'u-4', loadedAt: 0 })).toBe('updated');
    expect(classifyTicketListChange({ change: base, loadedTicketIds: new Set(), filters: {}, currentUserId: 'u-3', loadedAt: 0 })).toBe('ignore');
    expect(classifyTicketListChange({ change: { ...base, updatedAt: '1970-01-01T00:00:00Z' }, loadedTicketIds: new Set(), filters: {}, currentUserId: 'u-4', loadedAt: 0 })).toBe('ignore');
  });

  it('applies board, status, assignee and search predicates, and fails closed on missing metadata', () => {
    expect(matchesTicketListChange(base, { boardIds: ['b-1'], statusId: 's-open', assignedToIds: ['u-2'], searchQuery: 'printer' })).toBe(true);
    expect(matchesTicketListChange(base, { searchQuery: 'network' })).toBe(false);
    expect(matchesTicketListChange({ ...base, statusId: null }, {})).toBe(null);
  });

  it('fails closed when an active filter needs metadata absent from the event', () => {
    expect(matchesTicketListChange(base, { clientId: 'client-1' })).toBe(null);
    expect(matchesTicketListChange(base, { where: { clauses: [{ field: 'priority_id', operator: 'eq', value: 'p1' }] } as any })).toBe(null);
  });

  it('deduplicates ticket events and preserves a new ticket classification across later edits', () => {
    const first = recordTicketListChange(new Map(), 't-1', 'new', { kind: 'new', timestamp: 1 });
    const second = recordTicketListChange(first, 't-1', 'updated', { kind: 'updated', timestamp: 2 });
    expect(second.size).toBe(1);
    expect(second.get('t-1')).toEqual({ kind: 'new', timestamp: 1 });
  });
});
