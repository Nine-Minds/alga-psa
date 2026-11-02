import { describe, expect, it } from 'vitest';
import { ChangedSinceLoad } from './changedSinceLoad';
import type { TicketListChange } from './listChangeFilters';

const event = (ticketId: string, updatedAt: string, changeKind: 'created' | 'updated' = 'updated'): TicketListChange => ({
  ticketId, changeKind, boardId: 'board-a', statusId: 'open', statusIsClosed: false, assigneeIds: [], searchText: 'printer', actorUserId: 'other', updatedAt,
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
    state.load([], { boardId: 'board-a', boardFilterState: 'all' }, 'me', Date.parse('2026-01-01T00:00:00Z'));
    expect(state.record(event('new', '2026-01-01T00:01:00Z', 'created'))).toBe(true);
    expect(state.record(event('new', '2026-01-01T00:02:00Z'))).toBe(true);
    expect(state.record({ ...event('wrong', '2026-01-01T00:03:00Z', 'created'), boardId: 'board-b' })).toBe(true);
    expect(state.getCounts()).toEqual({ newCount: 1, updatedCount: 0 });
    expect(state.boards()).toEqual(new Set(['board-a', 'board-b']));
  });

  it('acknowledges only activity covered by a successful snapshot and preserves events during refresh', async () => {
    const state = new ChangedSinceLoad();
    state.load(['loaded'], {}, 'me', Date.parse('2026-01-01T00:00:00Z'));
    state.record(event('loaded', '2026-01-01T00:01:00Z'));
    const acknowledgeRefresh = async (ok: boolean, snapshotAt: number) => {
      if (ok) state.load(['loaded'], {}, 'me', snapshotAt);
    };

    // A failed request has no acknowledgement boundary.
    await acknowledgeRefresh(false, Date.parse('2026-01-01T00:02:00Z'));
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 1 });

    // This event arrives after the server snapshot completed but before React
    // commits it; it stays pending after the successful acknowledgement.
    state.record(event('loaded', '2026-01-01T00:03:00Z'));
    await acknowledgeRefresh(true, Date.parse('2026-01-01T00:02:00Z'));
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 1 });
  });

  it('tracks other-board activity independently and acknowledges only that board', () => {
    const state = new ChangedSinceLoad();
    state.load([], { boardId: 'board-x' }, 'me', Date.parse('2026-01-01T00:00:00Z'));
    state.record({ ...event('outside', '2026-01-01T00:01:00Z'), boardId: 'board-y' });
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 0 });
    expect(state.boards()).toEqual(new Set(['board-y']));
    state.acknowledgeBoard('board-x');
    expect(state.boards()).toEqual(new Set(['board-y']));
    state.acknowledgeBoard('board-y');
    expect(state.boards()).toEqual(new Set());
    expect(state.record(event('late', '2026-01-01T00:00:30Z', 'created'))).toBe(true);
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 0 });
  });

  it('reclassifies pending changes on a new filter snapshot and ignores out-of-order events', () => {
    const state = new ChangedSinceLoad();
    state.load([], { boardId: 'board-a' }, 'me', Date.parse('2026-01-01T00:00:00Z'));
    state.record(event('created', '2026-01-01T00:02:00Z', 'updated'));
    expect(state.getCounts()).toEqual({ newCount: 1, updatedCount: 0 });
    expect(state.record(event('created', '2026-01-01T00:01:00Z'))).toBe(false);
    state.load([], { boardId: 'board-b' }, 'me', Date.parse('2026-01-01T00:01:30Z'));
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 0 });
  });

  it('merges counts-only recovery without duplicate live events and preserves other-board activity across refresh', () => {
    const state = new ChangedSinceLoad();
    const loadedAt = Date.parse('2026-01-01T00:00:00Z');
    state.load([], { boardId: 'board-x' }, 'me', loadedAt);
    const outageEvent = event('ticket-y', '2026-01-01T00:01:00Z', 'created');
    state.record({ ...outageEvent, boardId: 'board-y' });
    state.setFallbackSnapshot({ since: loadedAt, asOf: Date.parse('2026-01-01T00:02:00Z'), newCount: 1, updatedCount: 0, boards: { 'board-y': 1, 'board-z': 1 } });
    expect(state.getCounts()).toEqual({ newCount: 1, updatedCount: 0 });
    expect(state.boards()).toEqual(new Set(['board-y', 'board-z']));
    state.load([], { boardId: 'board-y' }, 'me', Date.parse('2026-01-01T00:03:00Z'));
    // This snapshot covers the entire recovered window and acknowledges it.
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 0 });
    expect(state.boards()).toEqual(new Set(['board-z']));
    state.setFallbackSnapshot({ since: Date.parse('2026-01-01T00:03:00Z'), asOf: Date.parse('2026-01-01T00:04:00Z'), newCount: 0, updatedCount: 0, boards: { 'board-z': 1 } });
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 0 });
  });

  it('rejects stale recovery responses and reapplies board acknowledgments to later responses', () => {
    const state = new ChangedSinceLoad();
    state.load([], { boardId: 'board-x' }, 'me', Date.parse('2026-01-01T00:00:00Z'));
    const oldGeneration = state.getSnapshot().generation;
    state.load([], { boardId: 'board-y' }, 'me', Date.parse('2026-01-01T00:02:00Z'));
    expect(state.setFallbackSnapshot({ since: 0, asOf: Date.parse('2026-01-01T00:01:00Z'), newCount: 3, updatedCount: 0, boards: { 'board-z': 1 } }, oldGeneration)).toBe(false);
    state.acknowledgeBoard('board-z', Date.parse('2026-01-01T00:03:00Z'));
    state.setFallbackSnapshot({ since: 0, asOf: Date.parse('2026-01-01T00:04:00Z'), newCount: 1, updatedCount: 0,
      boards: { 'board-z': 1, 'board-w': 1 }, boardLatestAt: { 'board-z': '2026-01-01T00:02:00Z', 'board-w': '2026-01-01T00:03:30Z' } });
    expect(state.boards()).toEqual(new Set(['board-w']));
  });

  it('does not acknowledge board activity newer than the refreshed server snapshot', () => {
    const state = new ChangedSinceLoad();
    state.load([], { boardId: 'board-x' }, 'me', Date.parse('2026-01-01T00:00:00Z'));
    state.setFallbackSnapshot({ since: 0, asOf: Date.parse('2026-01-01T00:04:00Z'), newCount: 0, updatedCount: 0,
      boards: { 'board-y': 1 }, boardLatestAt: { 'board-y': '2026-01-01T00:03:00Z' } });
    state.load([], { boardId: 'board-y' }, 'me', Date.parse('2026-01-01T00:02:00Z'));
    expect(state.boards()).toEqual(new Set(['board-y']));
  });

  it('uses counts-only recovery as the authoritative distinct count while live badges continue', () => {
    const state = new ChangedSinceLoad();
    state.load([], { boardId: 'board-a' }, 'me', Date.parse('2026-01-01T00:00:00Z'));
    state.record(event('same-ticket', '2026-01-01T00:01:00Z', 'created'));
    state.setFallbackSnapshot({ since: 0, asOf: Date.parse('2026-01-01T00:02:00Z'), newCount: 1, updatedCount: 0, boards: {} });
    state.record(event('same-ticket', '2026-01-01T00:03:00Z'));
    expect(state.has('same-ticket')).toBe(true);
    expect(state.getCounts()).toEqual({ newCount: 1, updatedCount: 0 });
  });
  it('restores badges from recovery and clears them after a covering refresh', () => {
    const state = new ChangedSinceLoad();
    state.load(['loaded'], {}, 'me', 1000);
    state.setFallbackSnapshot({ since: 1000, asOf: 2000, newCount: 0, updatedCount: 1,
      boards: {}, updatedTicketIds: ['loaded'] });
    expect(state.has('loaded')).toBe(true);
    state.load(['loaded'], {}, 'me', 3000);
    expect(state.has('loaded')).toBe(false);
    expect(state.getCounts()).toEqual({ newCount: 0, updatedCount: 0 });
  });

});
