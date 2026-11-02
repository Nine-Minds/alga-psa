import { describe, expect, it } from 'vitest';
import { ChangedSinceLoad } from './changedSinceLoad';
import type { TicketListChange } from './listChangeFilters';

const event = (ticketId: string, updatedAt: string, changeKind: 'created' | 'updated' = 'updated'): TicketListChange => ({
  ticketId, changeKind, boardId: 'board-a', statusId: 'open', assigneeIds: [], searchText: 'printer', actorUserId: 'other', updatedAt,
});

describe('ChangedSinceLoad', () => {
  it('deduplicates, excludes own and pre-snapshot events, and resets on a new snapshot', () => {
    const state = new ChangedSinceLoad();
    state.load(['loaded'], {}, 'me', Date.parse('2026-01-01T00:00:00Z'));
    expect(state.record(event('loaded', '2026-01-01T00:01:00Z'))).toBe(true);
    state.record(event('loaded', '2026-01-01T00:02:00Z'));
    expect(state.record({ ...event('other', '2026-01-01T00:03:00Z', 'created'), actorUserId: 'me' })).toBe(false);
    expect(state.record(event('stale', '2026-01-01T00:00:00Z', 'created'))).toBe(false);
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 1 });
    state.load(['loaded'], {}, 'me', Date.parse('2026-01-01T00:04:00Z'));
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 0 });
  });

  it('classifies only matching absent creations and keeps one ticket in one category', () => {
    const state = new ChangedSinceLoad();
    state.load([], { boardId: 'board-a', searchQuery: 'printer', boardFilterState: 'all' }, 'me', Date.parse('2026-01-01T00:00:00Z'));
    expect(state.record(event('new', '2026-01-01T00:01:00Z', 'created'))).toBe(true);
    expect(state.record(event('new', '2026-01-01T00:02:00Z'))).toBe(true);
    expect(state.record({ ...event('wrong', '2026-01-01T00:03:00Z', 'created'), boardId: 'board-b' })).toBe(false);
    expect(state.getCounts()).toEqual({ newCount: 1, updatedCount: 0 });
    expect(state.boards()).toEqual(new Set(['board-a']));
  });
});
