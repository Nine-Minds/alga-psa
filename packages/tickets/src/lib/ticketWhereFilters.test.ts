import { describe, expect, it } from 'vitest';
import {
  getWhereTagSelection,
  setWhereTagSelection,
  whereFilterChips,
  whereTagFilterChips,
  WHERE_FILTERS,
  WHERE_LOCATION_FILTERS,
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

describe('ticket where location filters (descriptor table)', () => {
  it('keeps the two tag descriptors exactly as they were, in the same order', () => {
    // T062: the generalisation must be behaviour-neutral for the tag rows.
    expect(WHERE_TAG_FILTERS.map((d) => [d.path, d.taggedType, d.labelKey, d.defaultLabel])).toEqual([
      ['contact.tags', 'contact', 'filters.requesterTags', 'Requester tags'],
      ['client.tags', 'client', 'filters.clientTags', 'Client tags'],
    ]);
    expect(WHERE_FILTERS.slice(0, 2).map((d) => d.path)).toEqual(['contact.tags', 'client.tags']);
  });

  it('adds the two location descriptors, each naming the side it offers options from', () => {
    expect(WHERE_LOCATION_FILTERS.map((d) => [d.path, d.locationOf, d.labelKey, d.defaultLabel])).toEqual([
      ['location_id', 'ticket', 'filters.location', 'Location'],
      ['contact.locations', 'contact', 'filters.requesterLocation', 'Requester location'],
    ]);
    expect(WHERE_FILTERS).toHaveLength(4);
  });

  it('writes, reads and clears a location selection the same way a tag selection works', () => {
    const where = setWhereTagSelection(undefined, 'location_id', { mode: 'in', ids: ['loc-a', 'loc-b'] });
    expect(where).toEqual(group({ path: 'location_id', operator: 'in', value: ['loc-a', 'loc-b'] }));
    expect(getWhereTagSelection(where, 'location_id')).toEqual({ mode: 'in', ids: ['loc-a', 'loc-b'] });

    const both = setWhereTagSelection(where, 'contact.locations', { mode: 'not_in', ids: ['loc-c'] });
    expect(both?.clauses).toHaveLength(2);
    expect(getWhereTagSelection(both, 'contact.locations')).toEqual({ mode: 'not_in', ids: ['loc-c'] });

    expect(setWhereTagSelection(both, 'location_id', null)?.clauses).toEqual([
      { path: 'contact.locations', operator: 'not_in', value: ['loc-c'] },
    ]);
  });

  it('derives one chip per location with an individual clear, with no bespoke wiring', () => {
    const where = group(
      { path: 'location_id', operator: 'in', value: ['loc-a', 'loc-b'] },
      { path: 'contact.locations', operator: 'not_in', value: ['loc-c'] },
    );
    const names: Record<string, string> = { 'loc-a': 'Warehouse', 'loc-b': 'Head office', 'loc-c': 'Depot' };

    const chips = whereFilterChips(where, (_descriptor, id) => names[id], (descriptor) => descriptor.defaultLabel);
    expect(chips.map((chip) => chip.label)).toEqual([
      'Location = Warehouse',
      'Location = Head office',
      'Requester location ≠ Depot',
    ]);

    // Clearing one chip leaves the rest of that path's selection and the other path untouched.
    expect(chips[0].clear()?.clauses).toEqual([
      { path: 'contact.locations', operator: 'not_in', value: ['loc-c'] },
      { path: 'location_id', operator: 'in', value: ['loc-b'] },
    ]);
  });

  it('falls back to the id when a location is unknown, so the chip can still be cleared', () => {
    const where = group({ path: 'location_id', operator: 'in', value: ['loc-gone'] });
    const [chip] = whereFilterChips(where, () => undefined, (descriptor) => descriptor.defaultLabel);
    expect(chip.label).toBe('Location = loc-gone');
    expect(chip.clear()).toBeUndefined();
  });

  it('whereTagFilterChips still sees only the tag rows', () => {
    const where = group(
      { path: 'contact.tags', operator: 'in', value: ['tag-a'] },
      { path: 'location_id', operator: 'in', value: ['loc-a'] },
    );
    const chips = whereTagFilterChips(where, () => 'VIP', (descriptor) => descriptor.defaultLabel);
    expect(chips.map((chip) => chip.path)).toEqual(['contact.tags']);
  });
});
