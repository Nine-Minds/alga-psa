import { describe, expect, it, vi } from 'vitest';

import { buildAuthorizationAwarePage } from '../pagination/authorizationAwarePagination';

interface Row {
  id: number;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
}

function makeFetchPage(rows: Row[]) {
  return vi.fn(async (page: number, limit: number) => {
    const start = (page - 1) * limit;
    return {
      data: rows.slice(start, start + limit),
      total: rows.length,
    };
  });
}

describe('buildAuthorizationAwarePage', () => {
  it('returns only authorized rows and counts only authorized rows in total', async () => {
    const rows = makeRows(10);
    const result = await buildAuthorizationAwarePage<Row>({
      page: 1,
      limit: 25,
      fetchPage: makeFetchPage(rows),
      authorizeRecord: async (row) => row.id % 2 === 0,
    });

    expect(result.data.map((row) => row.id)).toEqual([2, 4, 6, 8, 10]);
    expect(result.total).toBe(5);
  });

  it('never leaks an unauthorized row into any page', async () => {
    const rows = makeRows(50);
    const denyIds = new Set([3, 7, 11, 12, 25, 49]);

    for (const page of [1, 2, 3]) {
      const result = await buildAuthorizationAwarePage<Row>({
        page,
        limit: 15,
        fetchPage: makeFetchPage(rows),
        authorizeRecord: async (row) => !denyIds.has(row.id),
      });
      expect(result.data.some((row) => denyIds.has(row.id))).toBe(false);
      expect(result.total).toBe(50 - denyIds.size);
    }
  });

  it('slices the requested page out of the authorized sequence', async () => {
    const rows = makeRows(30);
    // Authorized rows: multiples of 3 -> [3, 6, 9, ..., 30]
    const result = await buildAuthorizationAwarePage<Row>({
      page: 2,
      limit: 3,
      fetchPage: makeFetchPage(rows),
      authorizeRecord: async (row) => row.id % 3 === 0,
    });

    expect(result.data.map((row) => row.id)).toEqual([12, 15, 18]);
    expect(result.total).toBe(10);
  });

  it('scans across multiple source pages when authorization filters rows out', async () => {
    const rows = makeRows(30);
    const fetchPage = makeFetchPage(rows);

    const result = await buildAuthorizationAwarePage<Row>({
      page: 1,
      limit: 5,
      scanLimit: 10,
      fetchPage,
      authorizeRecord: async (row) => row.id > 25,
    });

    expect(result.data.map((row) => row.id)).toEqual([26, 27, 28, 29, 30]);
    expect(result.total).toBe(5);
    // 30 rows scanned at 10 per source page.
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1, 10);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 3, 10);
  });

  it('never fetches with a scan size below the requested limit', async () => {
    const rows = makeRows(60);
    const fetchPage = makeFetchPage(rows);

    await buildAuthorizationAwarePage<Row>({
      page: 1,
      limit: 50,
      scanLimit: 10,
      fetchPage,
      authorizeRecord: async () => true,
    });

    expect(fetchPage).toHaveBeenCalledWith(1, 50);
  });

  it('returns an empty page for an empty source', async () => {
    const result = await buildAuthorizationAwarePage<Row>({
      page: 1,
      limit: 10,
      fetchPage: makeFetchPage([]),
      authorizeRecord: async () => true,
    });

    expect(result).toEqual({ data: [], total: 0 });
  });

  it('clamps invalid page and limit values to safe defaults', async () => {
    const rows = makeRows(5);
    const result = await buildAuthorizationAwarePage<Row>({
      page: Number.NaN,
      limit: 0,
      fetchPage: makeFetchPage(rows),
      authorizeRecord: async () => true,
    });

    // page -> 1, limit -> 25
    expect(result.data.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.total).toBe(5);
  });

  it('stops scanning once the source reports a short page', async () => {
    const fetchPage = vi.fn(async () => ({ data: makeRows(4), total: 100 }));

    const result = await buildAuthorizationAwarePage<Row>({
      page: 1,
      limit: 2,
      scanLimit: 10,
      fetchPage,
      authorizeRecord: async () => true,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it('returns an empty slice when the requested page is beyond the authorized rows', async () => {
    const rows = makeRows(10);
    const result = await buildAuthorizationAwarePage<Row>({
      page: 5,
      limit: 10,
      fetchPage: makeFetchPage(rows),
      authorizeRecord: async (row) => row.id <= 4,
    });

    expect(result.data).toEqual([]);
    expect(result.total).toBe(4);
  });
});
