import { describe, expect, it } from 'vitest';
import { mergeCoManagedOverviewEntries, type CoManagedOverviewEntry } from '@alga-psa/co-managed';

const entry = (shape: 'seat' | 'workspace', clientName: string | null, key: string): CoManagedOverviewEntry => ({
  shape, clientName, key, clientId: `client-${key}`, state: 'active', seats: 2, usedSeats: 1, relationshipId: null });

describe('overview merge', () => {
  // F086
  it('lists both shapes in one client-name order', () => {
    const merged = mergeCoManagedOverviewEntries([
      entry('workspace', 'Beta', 'w1'), entry('seat', 'Acme', 's1'), entry('seat', 'Beta', 's2'), entry('workspace', 'Acme', 'w2'),
    ], { page: 1, pageSize: 10 });
    expect(merged.rows.map((row) => `${row.clientName}:${row.shape}`)).toEqual(['Acme:seat', 'Acme:workspace', 'Beta:seat', 'Beta:workspace']);
    expect(merged.totalCount).toBe(4);
  });

  it('pages after merging and reports the total of both shapes', () => {
    const entries = ['A', 'B', 'C', 'D', 'E'].map((name, index) => entry(index % 2 ? 'seat' : 'workspace', name, String(index)));
    expect(mergeCoManagedOverviewEntries(entries, { page: 2, pageSize: 2 }).rows.map((row) => row.clientName)).toEqual(['C', 'D']);
    expect(mergeCoManagedOverviewEntries(entries, { page: 3, pageSize: 2 })).toMatchObject({ totalCount: 5, rows: [{ clientName: 'E' }] });
    expect(mergeCoManagedOverviewEntries(entries, { page: 4, pageSize: 2 }).rows).toEqual([]);
  });

  it('puts a client with no name last and does not mutate its input', () => {
    const input = [entry('seat', null, 'n'), entry('seat', 'Zed', 'z')];
    expect(mergeCoManagedOverviewEntries(input, { page: 1, pageSize: 5 }).rows.map((row) => row.key)).toEqual(['n', 'z'].reverse().reverse());
    expect(input.map((row) => row.key)).toEqual(['n', 'z']);
  });
});
