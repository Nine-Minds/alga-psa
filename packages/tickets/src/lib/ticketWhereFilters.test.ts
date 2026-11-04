import { describe, expect, it } from 'vitest';
import {
  getWhereTagSelection,
  setWhereTagSelection,
  whereTagFilterChips,
  WHERE_TAG_FILTERS,
} from './ticketWhereFilters';

const group = (...clauses: any[]) => ({ join: 'and' as const, clauses });

describe('ticket where tag filters', () => {
  it('writes any-of and none-of predicates on contact.tags / client.tags', () => {
    expect(setWhereTagSelection(undefined, 'contact.tags', { mode: 'in', ids: ['a', 'b'] })).toEqual(
      group({ path: 'contact.tags', operator: 'in', value: ['a', 'b'] }),
    );
    expect(setWhereTagSelection(undefined, 'client.tags', { mode: 'not_in', ids: ['c'] })).toEqual(
      group({ path: 'client.tags', operator: 'not_in', value: ['c'] }),
    );
  });

  it('replaces only its own path and keeps other clauses', () => {
    const where = group(
      { path: 'client.tags', operator: 'in', value: ['c'] },
      { path: 'contact.tags', operator: 'in', value: ['a'] },
    );
    const next = setWhereTagSelection(where, 'contact.tags', { mode: 'not_in', ids: ['b'] });
    expect(next?.clauses).toEqual([
      { path: 'client.tags', operator: 'in', value: ['c'] },
      { path: 'contact.tags', operator: 'not_in', value: ['b'] },
    ]);
    expect(getWhereTagSelection(next, 'contact.tags')).toEqual({ mode: 'not_in', ids: ['b'] });
  });

  it('clearing the last selection drops the clause and the empty group', () => {
    const where = group({ path: 'contact.tags', operator: 'in', value: ['a'] });
    expect(setWhereTagSelection(where, 'contact.tags', null)).toBeUndefined();
    expect(setWhereTagSelection(where, 'contact.tags', { mode: 'in', ids: [] })).toBeUndefined();
  });

  it('derives one chip per tag from the descriptor table and clears individually', () => {
    const where = group({ path: 'contact.tags', operator: 'in', value: ['a', 'b'] });
    const chips = whereTagFilterChips(
      where,
      (_d, id) => ({ a: 'VIP', b: 'POC' } as Record<string, string>)[id],
      (d) => d.defaultLabel,
    );
    expect(chips.map((c) => c.label)).toEqual(['Requester tags = VIP', 'Requester tags = POC']);
    expect(getWhereTagSelection(chips[0].clear(), 'contact.tags')).toEqual({ mode: 'in', ids: ['b'] });
    expect(chips[1].clear()?.clauses).toEqual([{ path: 'contact.tags', operator: 'in', value: ['a'] }]);
  });

  it('has a descriptor for both paths', () => {
    expect(WHERE_TAG_FILTERS.map((d) => d.path)).toEqual(['contact.tags', 'client.tags']);
  });
});
