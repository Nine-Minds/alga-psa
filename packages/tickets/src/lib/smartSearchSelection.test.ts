import { describe, expect, it } from 'vitest';
import type { ITicketListFilters, ITicketListItem } from '@alga-psa/types';

import {
  buildSelectedTicketDetails,
  collectSelectedTicketRows,
  pruneSelectedTicketIds,
  selectAllMatchingFallbackIds,
  selectAllMatchingScope,
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
