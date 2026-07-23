import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: dbMocks.tenantDb,
}));

import { listOpportunityTimelineCore } from '../src/lib/opportunityTimelineCore';

function makeTimelineQuery(rows: Array<Record<string, unknown>>) {
  let order: 'asc' | 'desc' = 'asc';
  let limit = rows.length;

  const query: any = {
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: Array<Record<string, unknown>>) => unknown, reject: (error: unknown) => unknown) => {
      const ordered = [...rows].sort((left, right) => {
        const comparison = String(left.interaction_date).localeCompare(String(right.interaction_date));
        return order === 'desc' ? -comparison : comparison;
      });
      return Promise.resolve(ordered.slice(0, limit)).then(resolve, reject);
    },
  };

  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockImplementation((_column: string, direction: 'asc' | 'desc') => {
    order = direction;
    return query;
  });
  query.limit.mockImplementation((value: number) => {
    limit = value;
    return query;
  });
  query.select.mockReturnValue(query);

  return query;
}

describe('listOpportunityTimelineCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the newest linked interactions first and applies the requested limit', async () => {
    const query = makeTimelineQuery([
      { interaction_id: 'older', interaction_date: '2026-07-14T12:00:00.000Z' },
      { interaction_id: 'newest', interaction_date: '2026-07-16T12:00:00.000Z' },
      { interaction_id: 'middle', interaction_date: '2026-07-15T12:00:00.000Z' },
    ]);
    const table = vi.fn(() => query);
    dbMocks.tenantDb.mockReturnValue({ table });
    const knex = { raw: vi.fn((sql: string) => sql) } as any;

    const result = await listOpportunityTimelineCore(knex, 'tenant-1', 'opportunity-1', 2);

    expect(dbMocks.tenantDb).toHaveBeenCalledWith(knex, 'tenant-1');
    expect(table).toHaveBeenCalledWith('interactions as i');
    expect(query.where).toHaveBeenCalledWith('i.opportunity_id', 'opportunity-1');
    expect(query.orderBy).toHaveBeenCalledWith('i.interaction_date', 'desc');
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(result.map((row) => row.interaction_id)).toEqual(['newest', 'middle']);
  });
});
