import { describe, expect, it, vi } from 'vitest';
import type { ITicketListFilters, ITicketListItem } from '@alga-psa/types';

import {
  buildSelectedTicketDetails,
  collectSelectedTicketRows,
  createSmartSearchRunCache,
  mergeSmartSearchRunRows,
  pruneSelectedTicketIds,
  selectAllMatchingFallbackIds,
  selectAllMatchingScope,
  selectMatchingTickets,
  smartSearchRunCandidateIds,
  smartSearchRunRows,
} from './smartSearchSelection';

function ticket(id: string, overrides: Partial<ITicketListItem> = {}): ITicketListItem {
  return {
    ticket_id: id,
    ticket_number: `T-${id}`,
    title: `Title ${id}`,
    client_id: 'client-1',
    client_name: 'Client One',
    board_id: 'board-1',
    ...overrides,
  } as unknown as ITicketListItem;
}

describe('pending select-all enumeration', () => {
  function pendingSelection() {
    let resolve!: (ids: string[]) => void;
    let reject!: (error: unknown) => void;
    const request = new Promise<string[]>((yes, no) => { resolve = yes; reject = no; });
    const generation = { current: 1 };
    const startedGeneration = generation.current;
    const onSelect = vi.fn();
    const onError = vi.fn();
    const done = selectMatchingTickets({
      loadIds: () => request,
      isCurrent: () => generation.current === startedGeneration,
      fallbackIds: ['board-a-streamed'],
      onSelect,
      onError,
    });
    return { resolve, reject, generation, onSelect, onError, done };
  }

  it.each(['rerun', 'exit', 'reset'])('ignores old enumeration after %s invalidates the generation', async () => {
    const pending = pendingSelection();
    pending.generation.current += 1;
    pending.resolve(['board-a-ticket']);
    await pending.done;
    expect(pending.onSelect).not.toHaveBeenCalled();
    expect(pending.onError).not.toHaveBeenCalled();
  });

  it('does not restore the old fallback or show its error after a disjoint-filter rerun', async () => {
    const pending = pendingSelection();
    pending.generation.current += 1;
    pending.reject(new Error('Board A enumeration failed'));
    await pending.done;
    expect(pending.onSelect).not.toHaveBeenCalled();
    expect(pending.onError).not.toHaveBeenCalled();
  });

  it('applies the whole candidate set while the initiating run remains current', async () => {
    const pending = pendingSelection();
    // Ordinary page refreshes do not change this generation.
    pending.resolve(['board-a-streamed', 'board-a-not-yet-scored']);
    await pending.done;
    expect(pending.onSelect).toHaveBeenCalledExactlyOnceWith(['board-a-streamed', 'board-a-not-yet-scored']);
    expect(pending.onError).not.toHaveBeenCalled();
  });

  it('uses the current run fallback and reports a current enumeration failure', async () => {
    const pending = pendingSelection();
    const error = new Error('Enumeration failed');
    pending.reject(error);
    await pending.done;
    expect(pending.onSelect).toHaveBeenCalledExactlyOnceWith(['board-a-streamed']);
    expect(pending.onError).toHaveBeenCalledExactlyOnceWith(error);
  });
});

describe('smart search selection', () => {
  it('resolves a streamed row the ordinary list never held', () => {
    const ordinary = [ticket('on-page')];
    const streamed = [ticket('off-page', { title: 'Streamed result' })];

    const { rows, missingIds } = collectSelectedTicketRows(['on-page', 'off-page'], [ordinary, streamed]);

    expect(rows.map((row) => row.ticket_id)).toEqual(['on-page', 'off-page']);
    expect(missingIds).toEqual([]);
  });

  it('reports selected ids that no source holds so the caller can hydrate them', () => {
    const { rows, missingIds } = collectSelectedTicketRows(['known', 'gone'], [[ticket('known')]]);

    expect(rows.map((row) => row.ticket_id)).toEqual(['known']);
    expect(missingIds).toEqual(['gone']);
  });

  it('includes a streamed off-page ticket in the bundle master picker details', () => {
    // Regression: the picker read only the paginated list, so selecting two
    // streamed results left it with no options.
    const details = buildSelectedTicketDetails(
      ['smart-a', 'smart-b'],
      [[], [ticket('smart-a'), ticket('smart-b')]]
    );

    expect(details.map((detail) => detail.ticket_id)).toEqual(['smart-a', 'smart-b']);
    expect(details.map((detail) => detail.ticket_number)).toEqual(['T-smart-a', 'T-smart-b']);
  });

  it('sorts details by ticket number, matching the ordinary selection behavior', () => {
    const details = buildSelectedTicketDetails(
      ['b', 'a', 'c'],
      [[ticket('b', { ticket_number: 'T-2' }), ticket('a', { ticket_number: 'T-10' }), ticket('c', { ticket_number: 'T-1' })]]
    );

    expect(details.map((detail) => detail.ticket_number)).toEqual(['T-1', 'T-2', 'T-10']);
  });

  it('keeps smart selections when the ordinary paginated list refreshes', () => {
    const previous = new Set(['streamed-a', 'streamed-b']);
    const pageIds = new Set(['streamed-a']); // b is off the refreshed page

    expect(pruneSelectedTicketIds(previous, pageIds, true)).toBe(previous);

    const pruned = pruneSelectedTicketIds(previous, pageIds, false);
    expect(Array.from(pruned)).toEqual(['streamed-a']);
  });

  it('leaves an already-consistent ordinary selection untouched', () => {
    const previous = new Set(['t1']);
    expect(pruneSelectedTicketIds(previous, new Set(['t1', 't2']), false)).toBe(previous);
  });

  it('enumerates the chip-only scope in smart mode', () => {
    const exportFilters = { searchQuery: 'email not being received' } as ITicketListFilters;
    const smartFilters = { searchQuery: '' } as ITicketListFilters;

    expect(selectAllMatchingScope(false, smartFilters, exportFilters)).toBe(exportFilters);
    expect(selectAllMatchingScope(true, smartFilters, exportFilters)).toBe(smartFilters);
  });

  it('enumerates the captured run scope while the current chips are stale', () => {
    // The run scored All tickets; the user has since clicked another board tab,
    // so current filters differ. Select-all must stay inside the run's scope.
    const capturedScope = { boardIds: undefined, searchQuery: '' } as ITicketListFilters;
    const staleCurrentChips = { boardIds: ['projects-board'], searchQuery: '' } as ITicketListFilters;

    expect(selectAllMatchingScope(true, capturedScope, staleCurrentChips)).toBe(capturedScope);
  });

  it('retains the full chip-filtered candidate set for a semantic query with zero keyword matches', () => {
    // The Jev query matches no ticket by keyword; the candidate set is the chips.
    const chipFilteredIds = ['t1', 't2', 't3', 't4', 't5'];
    const fakeGetAllMatchingTicketIds = (scope: ITicketListFilters): string[] =>
      scope.searchQuery ? [] : chipFilteredIds;

    const exportFilters = { searchQuery: 'printer keeps going offline' } as ITicketListFilters;
    const smartFilters = { searchQuery: '' } as ITicketListFilters;

    expect(fakeGetAllMatchingTicketIds(exportFilters)).toEqual([]);
    expect(
      fakeGetAllMatchingTicketIds(selectAllMatchingScope(true, smartFilters, exportFilters))
    ).toEqual(chipFilteredIds);
  });

  it('falls back to the streamed smart candidates rather than the ordinary page', () => {
    expect(selectAllMatchingFallbackIds(true, ['streamed-a', 'streamed-b'], ['page-1'])).toEqual([
      'streamed-a',
      'streamed-b',
    ]);
    expect(selectAllMatchingFallbackIds(false, ['streamed-a'], ['page-1', 'page-2'])).toEqual(['page-1', 'page-2']);
  });
});

describe('smart search run cache lifecycle', () => {
  it('replaces the previous run cache on a disjoint-filter rerun and discards a stale report', () => {
    // Board A run streams its rows.
    let runA = createSmartSearchRunCache<ITicketListItem>('run-a', 1);
    runA = mergeSmartSearchRunRows(runA, { runKey: 'run-a', generation: 1, rows: [ticket('a1'), ticket('a2')] });
    expect(smartSearchRunCandidateIds(runA, 'run-a')).toEqual(['a1', 'a2']);

    // Switching to board B begins a fresh run with a fresh cache.
    let runB = createSmartSearchRunCache<ITicketListItem>('run-b', 2);
    // A late board-A report (old run/generation) must not repopulate anything.
    runB = mergeSmartSearchRunRows(runB, { runKey: 'run-a', generation: 1, rows: [ticket('a1'), ticket('a2')] });
    expect(smartSearchRunCandidateIds(runB, 'run-b')).toEqual([]);

    runB = mergeSmartSearchRunRows(runB, { runKey: 'run-b', generation: 2, rows: [ticket('b1')] });
    expect(smartSearchRunCandidateIds(runB, 'run-b')).toEqual(['b1']);
    // Board A's run is no longer active, so its rows are invisible.
    expect(smartSearchRunCandidateIds(runB, 'run-a')).toEqual([]);
  });

  it('ignores a report from a superseded generation of the same run key', () => {
    const cache = createSmartSearchRunCache<ITicketListItem>('run-x', 5);
    const stale = mergeSmartSearchRunRows(cache, { runKey: 'run-x', generation: 4, rows: [ticket('old')] });
    expect(stale).toBe(cache);
    expect(smartSearchRunCandidateIds(stale, 'run-x')).toEqual([]);
  });

  it('serves no rows while smart mode is inactive and rebuilds on re-entry', () => {
    let cache = createSmartSearchRunCache<ITicketListItem>('run-1', 1);
    cache = mergeSmartSearchRunRows(cache, { runKey: 'run-1', generation: 1, rows: [ticket('a')] });
    expect(smartSearchRunCandidateIds(cache, 'run-1')).toEqual(['a']);

    // Exit: no active run key, so the cache cannot feed ordinary-list actions.
    expect(smartSearchRunRows(cache, null)).toEqual([]);
    expect(smartSearchRunCandidateIds(cache, null)).toEqual([]);

    // Re-entry starts a new run; the old rows are gone.
    const reentry = createSmartSearchRunCache<ITicketListItem>('run-2', 2);
    expect(smartSearchRunCandidateIds(reentry, 'run-2')).toEqual([]);
    const merged = mergeSmartSearchRunRows(reentry, { runKey: 'run-2', generation: 2, rows: [ticket('b')] });
    expect(smartSearchRunCandidateIds(merged, 'run-2')).toEqual(['b']);
  });

  it('a failed select-all fallback keeps only the current run candidate set', () => {
    // After board A then board B, only board B is cached and active.
    let cache = createSmartSearchRunCache<ITicketListItem>('board-b', 2);
    cache = mergeSmartSearchRunRows(cache, { runKey: 'board-b', generation: 2, rows: [ticket('b1'), ticket('b2')] });
    const candidateIds = smartSearchRunCandidateIds(cache, 'board-b');
    expect(selectAllMatchingFallbackIds(true, candidateIds, ['page-1'])).toEqual(['b1', 'b2']);
  });
});
