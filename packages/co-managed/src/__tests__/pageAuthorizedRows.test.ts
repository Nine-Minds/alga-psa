import { describe, expect, it } from 'vitest';
import { pageAuthorizedRows } from '../pageAuthorizedRows';

type Candidate = { id: number; date: number };

describe('pageAuthorizedRows', () => {
  it('bounds work on a large corpus and reports a capped total as inexact', async () => {
    const corpus = Array.from({ length: 10_000 }, (_, id) => ({ id, date: 1_000 - Math.floor(id / 2) }));
    let fetched = 0, authorized = 0;
    const result = await pageAuthorizedRows({ page: 1, pageSize: 10, maxWindows: 4,
      fetchCandidates: async (after: Candidate | null, limit: number) => {
        const start = after ? corpus.indexOf(after) + 1 : 0;
        const window = corpus.slice(start, start + limit); fetched += window.length; return window;
      },
      authorize: async row => { authorized++; return row; }, matches: () => true });
    expect(result.rows).toHaveLength(10);
    expect(result.total).toBe(200);
    expect(result.totalExact).toBe(false);
    expect(fetched).toBe(200);
    expect(authorized).toBe(200);
  });

  it('exhausts exactly four windows and applies search only after authorization', async () => {
    const corpus = Array.from({ length: 500 }, (_, id) => ({ id, date: 1 }));
    const visited: number[] = [];
    const result = await pageAuthorizedRows({ page: 1, pageSize: 20, maxWindows: 4,
      fetchCandidates: async (after: Candidate | null, limit: number) => corpus.slice(after ? corpus.indexOf(after) + 1 : 0, (after ? corpus.indexOf(after) + 1 : 0) + limit),
      authorize: async row => { visited.push(row.id); return row.id % 2 ? null : { ...row, label: row.id === 198 ? 'needle' : 'hidden' }; },
      matches: () => true, searchMatches: row => row.label === 'needle' });
    expect(visited).toHaveLength(200);
    expect(result.rows.map(row => row.id)).toEqual([198]);
    expect(result.total).toBe(1);
    expect(result.totalExact).toBe(false);
  });

  it('does not let hidden labels affect observable search matches', async () => {
    const rows = [{ id: 1, restrictedLabel: 'secret customer' }, { id: 2, restrictedLabel: 'visible customer' }];
    const authorizedIds: number[] = [];
    const result = await pageAuthorizedRows({ page: 1, pageSize: 10,
      fetchCandidates: async () => rows,
      authorize: async candidate => {
        authorizedIds.push(candidate.id);
        // The authorization projection masks this field before the search phase.
        return { id: candidate.id, label: candidate.id === 1 ? null : candidate.restrictedLabel };
      },
      matches: () => true,
      searchMatches: row => String(row.label ?? '').includes('secret'),
    });
    expect(authorizedIds).toEqual([1, 2]);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalExact).toBe(true);
  });

  it('preserves candidate order across equal sort keys and produces exact totals at exhaustion', async () => {
    const corpus = [{ id: 1, date: 9 }, { id: 2, date: 9 }, { id: 3, date: 8 }];
    const result = await pageAuthorizedRows({ page: 1, pageSize: 2,
      fetchCandidates: async (after: Candidate | null) => corpus.slice(after ? corpus.indexOf(after) + 1 : 0),
      authorize: async row => row, matches: () => true });
    expect(result.rows.map(row => row.id)).toEqual([1, 2]);
    expect(result.total).toBe(3);
    expect(result.totalExact).toBe(true);
  });

  it('continues after a tied timestamp without duplicates or omissions across pages', async () => {
    const corpus = Array.from({ length: 9 }, (_, id) => ({ id, date: id < 7 ? 9 : 8 }));
    const readPage = (page: number) => pageAuthorizedRows({ page, pageSize: 3,
      fetchCandidates: async (after: Candidate | null, limit: number) => {
        const start = after ? corpus.findIndex(row => row.id === after.id) + 1 : 0;
        return corpus.slice(start, start + limit);
      }, authorize: async row => row, matches: () => true });
    const pages = await Promise.all([readPage(1), readPage(2), readPage(3)]);
    expect(pages.flatMap(page => page.rows.map(row => row.id))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('caps a caller supplied window budget and rejects excessive page sizes', async () => {
    let windows = 0;
    const result = await pageAuthorizedRows({ page: 1, pageSize: 1, maxWindows: 10_000,
      fetchCandidates: async () => { windows++; return Array.from({ length: 50 }, (_, id) => ({ id, date: 1 })); },
      authorize: async row => row, matches: () => true });
    expect(windows).toBe(4);
    expect(result.totalExact).toBe(false);
    await expect(pageAuthorizedRows({ page: 1, pageSize: 101,
      fetchCandidates: async () => [], authorize: async row => row, matches: () => true })).rejects.toThrow(RangeError);
    await expect(pageAuthorizedRows({ page: 10_001, pageSize: 1,
      fetchCandidates: async () => [], authorize: async row => row, matches: () => true })).rejects.toThrow(RangeError);
  });

  it('terminates sparse authorization and search misses at the configured ceiling', async () => {
    let authorized = 0;
    const result = await pageAuthorizedRows({ page: 1, pageSize: 10, maxWindows: 4,
      fetchCandidates: async (_after: Candidate | null, limit: number) => Array.from({ length: limit }, (_, id) => ({ id, date: 1 })),
      authorize: async () => { authorized++; return null; }, matches: () => true });
    expect(authorized).toBe(200);
    expect(result.rows).toEqual([]);
    expect(result.totalExact).toBe(false);
    expect(result.nextAfter).toEqual({ id: 49, date: 1 });
  });
});
