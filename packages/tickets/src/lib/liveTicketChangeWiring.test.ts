import { describe, expect, it, vi } from 'vitest';
import { ChangedSinceLoad } from './changedSinceLoad';
import { handleTicketListChangeForDashboard } from './liveTicketChangeWiring';
import type { TicketListChange } from './listChangeFilters';

const event = (overrides: Partial<TicketListChange> = {}): TicketListChange => ({
  ticketId: 'ticket-new', changeKind: 'updated', boardId: null, statusId: 'open', assigneeIds: [],
  searchText: 'printer offline', actorUserId: 'another-user', updatedAt: '2026-11-02T12:01:00Z',
  ...overrides,
});

describe('dashboard live change recovery wiring', () => {
  it('reconciles indexed search membership when an unclassifiable no-board event leaves state unchanged', () => {
    const state = new ChangedSinceLoad();
    state.load([], { searchQuery: 'printer' }, 'viewer', Date.parse('2026-11-02T12:00:00Z'));
    const onStateChanged = vi.fn();
    const reconcileCounts = vi.fn();

    expect(handleTicketListChangeForDashboard(event(), state, 'printer', onStateChanged, reconcileCounts)).toBe(false);
    expect(onStateChanged).not.toHaveBeenCalled();
    expect(reconcileCounts).toHaveBeenCalledOnce();
  });

  it('reconciles equal-timestamp repeats even when the same-board event is deduplicated', () => {
    const state = new ChangedSinceLoad();
    state.load([], { searchQuery: 'printer' }, 'viewer', Date.parse('2026-11-02T12:00:00Z'));
    const first = event({ boardId: 'board-a' });
    state.record(first);
    const reconcileCounts = vi.fn();

    expect(handleTicketListChangeForDashboard(first, state, 'printer', vi.fn(), reconcileCounts)).toBe(false);
    expect(reconcileCounts).toHaveBeenCalledOnce();
  });
});
