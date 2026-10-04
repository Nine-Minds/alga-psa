import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: dbMocks.tenantDb,
}));

import { OpportunityModel } from '../src/models/opportunityModel';

function makeQuery(rows: Record<string, unknown>[]) {
  const searchBuilder = {
    whereILike: vi.fn(),
    orWhereILike: vi.fn(),
  } as any;
  searchBuilder.whereILike.mockReturnValue(searchBuilder);
  searchBuilder.orWhereILike.mockReturnValue(searchBuilder);

  const query: any = {
    where: vi.fn(),
    whereRaw: vi.fn(),
    select: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };

  query.where.mockImplementation((condition: unknown) => {
    if (typeof condition === 'function') {
      condition.call(searchBuilder);
    }
    return query;
  });
  query.whereRaw.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockReturnValue(query);

  return { query, searchBuilder };
}

describe('OpportunityModel.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns contract list items from one joined query and applies one stalled threshold everywhere', async () => {
    const { query, searchBuilder } = makeQuery([{
      opportunity_id: 'opportunity-1',
      opportunity_number: 'OPP-0001',
      title: 'Managed services expansion',
      client_id: 'client-1',
      client_name: 'Acme MSP',
      client_lifecycle_status: 'active',
      owner_id: 'user-1',
      owner_name: 'Ada Lovelace',
      status: 'open',
      stage: 'qualified',
      confidence: 'high',
      opportunity_type: 'expansion',
      mrr_cents: '25000',
      nrr_cents: '5000',
      hardware_cents: '1000',
      currency_code: 'USD',
      expected_close_date: '2026-08-31',
      next_action: 'Review assessment',
      next_action_due: '2026-07-15T14:00:00.000Z',
      days_since_activity: '22',
      is_stalled: true,
      _total_count: '3',
    }]);
    const facade = { table: vi.fn(() => query), tenantJoin: vi.fn() };
    dbMocks.tenantDb.mockReturnValue(facade);
    const raw = vi.fn((sql: string, bindings?: unknown[]) => ({ sql, bindings }));
    const conn = { raw } as any;

    const result = await OpportunityModel.list(conn, 'tenant-1', {
      stalled_only: true,
      search: 'Acme',
      sort_by: 'created_at',
      sort_direction: 'desc',
      page: 2,
      page_size: 10,
    }, 21);

    expect(facade.table).toHaveBeenCalledTimes(1);
    expect(facade.tenantJoin).toHaveBeenNthCalledWith(1, query, 'clients as c', 'o.client_id', 'c.client_id');
    expect(facade.tenantJoin).toHaveBeenNthCalledWith(2, query, 'users as u', 'o.owner_id', 'u.user_id');
    expect(query.whereRaw).toHaveBeenCalledWith(
      "o.last_activity_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')",
      [21],
    );
    expect(raw.mock.calls.some(([, bindings]) => bindings?.[0] === 21)).toBe(true);
    expect(query.orderBy).toHaveBeenCalledWith('o.created_at', 'desc');
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(query.offset).toHaveBeenCalledWith(10);
    expect(searchBuilder.whereILike).toHaveBeenCalledWith('o.title', '%Acme%');

    expect(result).toEqual({
      data: [{
        opportunity_id: 'opportunity-1',
        opportunity_number: 'OPP-0001',
        title: 'Managed services expansion',
        client_id: 'client-1',
        client_name: 'Acme MSP',
        client_lifecycle_status: 'active',
        owner_id: 'user-1',
        owner_name: 'Ada Lovelace',
        status: 'open',
        stage: 'qualified',
        confidence: 'high',
        opportunity_type: 'expansion',
        mrr_cents: 25000,
        nrr_cents: 5000,
        hardware_cents: 1000,
        currency_code: 'USD',
        values_locked_by_quote: false,
        expected_close_date: '2026-08-31',
        next_action: 'Review assessment',
        next_action_due: '2026-07-15T14:00:00.000Z',
        days_since_activity: 22,
        is_stalled: true,
      }],
      total: 3,
      page: 2,
      page_size: 10,
    });
  });

  // The pg driver returns a Date for a `date` column. Reading it as an instant
  // shifted the day across a timezone and handed callers a value their own PUT
  // would reject, so both read paths emit the calendar date.
  it('emits expected_close_date as a calendar date for a driver Date', async () => {
    const { query } = makeQuery([{
      opportunity_id: 'opportunity-1',
      opportunity_number: 'OPP-0002',
      title: 'Renewal',
      client_id: 'client-1',
      owner_id: 'user-1',
      status: 'open',
      stage: 'identified',
      confidence: 'medium',
      opportunity_type: 'renewal',
      currency_code: 'USD',
      // Local midnight, the shape the driver hands back for a `date` column.
      expected_close_date: new Date(2026, 7, 31),
      next_action_due: '2026-07-15T14:00:00.000Z',
      _total_count: '1',
    }]);
    dbMocks.tenantDb.mockReturnValue({ table: vi.fn(() => query), tenantJoin: vi.fn() });
    const conn = { raw: vi.fn((sql: string, bindings?: unknown[]) => ({ sql, bindings })) } as any;

    const result = await OpportunityModel.list(conn, 'tenant-1', {}, 14);

    expect(result.data[0].expected_close_date).toBe('2026-08-31');
    // next_action_due is a real instant and stays one.
    expect(result.data[0].next_action_due).toBe('2026-07-15T14:00:00.000Z');
  });

  it('truncates a timestamp-shaped expected_close_date on getById', async () => {
    const detailQuery: any = {
      where: vi.fn(),
      first: vi.fn().mockResolvedValue({
        opportunity_id: 'opportunity-1',
        expected_close_date: '2026-08-31T00:00:00.000Z',
        next_action_due: '2026-07-15T14:00:00.000Z',
      }),
    };
    detailQuery.where.mockReturnValue(detailQuery);
    dbMocks.tenantDb.mockReturnValue({ table: vi.fn(() => detailQuery) });

    const result = await OpportunityModel.getById({} as any, 'tenant-1', 'opportunity-1');

    expect(result?.expected_close_date).toBe('2026-08-31');
    expect(result?.next_action_due).toBe('2026-07-15T14:00:00.000Z');
  });

  it('preserves an explicitly null expected_close_date', async () => {
    const detailQuery: any = {
      where: vi.fn(),
      first: vi.fn().mockResolvedValue({ opportunity_id: 'opportunity-1', expected_close_date: null }),
    };
    detailQuery.where.mockReturnValue(detailQuery);
    dbMocks.tenantDb.mockReturnValue({ table: vi.fn(() => detailQuery) });

    expect((await OpportunityModel.getById({} as any, 'tenant-1', 'opportunity-1'))?.expected_close_date).toBeNull();
  });

  it('falls back to the whitelisted default sort for an untrusted runtime value', async () => {
    const { query } = makeQuery([]);
    dbMocks.tenantDb.mockReturnValue({ table: vi.fn(() => query), tenantJoin: vi.fn() });
    const conn = { raw: vi.fn((sql: string, bindings?: unknown[]) => ({ sql, bindings })) } as any;

    await OpportunityModel.list(conn, 'tenant-1', {
      sort_by: 'created_at; DROP TABLE opportunities' as any,
    }, 14);

    expect(query.orderBy).toHaveBeenCalledWith('o.next_action_due', 'asc');
  });
});
