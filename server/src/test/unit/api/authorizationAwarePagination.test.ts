import { describe, expect, it, vi } from 'vitest';
import { buildAuthorizationAwarePage } from 'server/src/lib/api/controllers/authorizationAwarePagination';

function buildPagedFetcher<T>(rows: T[]) {
  return vi.fn(async (page: number, limit: number) => {
    const offset = (page - 1) * limit;
    return {
      data: rows.slice(offset, offset + limit),
      total: rows.length,
    };
  });
}

describe('authorization-aware pagination', () => {
  it('T012: keeps ticket list pagination coherent and does not strand authorized rows behind filtered source pages', async () => {
    const rows = [
      { ticket_id: 't-1' },
      { ticket_id: 't-2' },
      { ticket_id: 't-3' },
      { ticket_id: 't-4' },
      { ticket_id: 't-5' },
      { ticket_id: 't-6' },
      { ticket_id: 't-7' },
    ];
    const fetchPage = buildPagedFetcher(rows);
    const authorizeRecord = vi.fn(async (row: { ticket_id: string }) => ['t-3', 't-4', 't-7'].includes(row.ticket_id));

    const page = await buildAuthorizationAwarePage({
      page: 2,
      limit: 2,
      fetchPage,
      authorizeRecord,
      scanLimit: 2,
    });

    expect(page.total).toBe(3);
    expect(page.data).toEqual([{ ticket_id: 't-7' }]);
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('T013: keeps project list pagination coherent after authorization narrowing', async () => {
    const rows = [
      { project_id: 'p-1' },
      { project_id: 'p-2' },
      { project_id: 'p-3' },
      { project_id: 'p-4' },
      { project_id: 'p-5' },
    ];
    const fetchPage = buildPagedFetcher(rows);

    const page = await buildAuthorizationAwarePage({
      page: 1,
      limit: 2,
      fetchPage,
      authorizeRecord: async (row: { project_id: string }) => ['p-2', 'p-5'].includes(row.project_id),
      scanLimit: 2,
    });

    expect(page.total).toBe(2);
    expect(page.data).toEqual([{ project_id: 'p-2' }, { project_id: 'p-5' }]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('T014: keeps quote list pagination coherent and preserves fail-closed narrowing totals', async () => {
    const rows = [
      { quote_id: 'q-1' },
      { quote_id: 'q-2' },
      { quote_id: 'q-3' },
      { quote_id: 'q-4' },
    ];
    const fetchPage = buildPagedFetcher(rows);

    const page = await buildAuthorizationAwarePage({
      page: 1,
      limit: 3,
      fetchPage,
      authorizeRecord: async (row: { quote_id: string }) => row.quote_id === 'q-3',
      scanLimit: 2,
    });

    expect(page.total).toBe(1);
    expect(page.data).toEqual([{ quote_id: 'q-3' }]);
  });
});
