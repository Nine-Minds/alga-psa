/**
 * Compile-only SQL-shape test (no DB): the tenant facade must emit the tenant
 * distribution-key equality on the write-off report's users join. Citus rejects
 * co-located distributed outer joins without it — this exact missing predicate
 * was the production write-off report failure (see
 * docs/plans/2026-07-06-inventory-citus-errors-plan.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import knexLib from 'knex';
import { tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { marginReport } from './inventoryReportingActions';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
    withTransaction: withTransactionMock,
  };
});

describe('inventoryReportingActions SQL shape', () => {
  const knex = knexLib({ client: 'pg' });
  const TENANT = '00000000-0000-0000-0000-000000000001';

  it('write-off users join carries the tenant distribution key (inferred, no rootTenantColumn)', () => {
    const scopedDb = tenantDb(knex, TENANT);
    const q = scopedDb.table('stock_movements as sm');
    scopedDb.tenantJoin(q, 'users as u', 'u.user_id', 'sm.performed_by', { type: 'left' });
    const { sql } = q.select('sm.movement_id').toSQL();

    expect(sql).toContain('left join "users" as "u"');
    expect(sql).toContain('"u"."tenant" = "sm"."tenant"');
  });

  it('write-off location joins carry the tenant distribution key on both aliases', () => {
    const scopedDb = tenantDb(knex, TENANT);
    const q = scopedDb.table('stock_movements as sm');
    scopedDb.tenantJoin(q, 'stock_locations as floc', 'floc.location_id', 'sm.from_location_id', { type: 'left' });
    scopedDb.tenantJoin(q, 'stock_locations as tloc', 'tloc.location_id', 'sm.to_location_id', { type: 'left' });
    const { sql } = q.select('sm.movement_id').toSQL();

    expect(sql).toContain('"floc"."tenant" = "sm"."tenant"');
    expect(sql).toContain('"tloc"."tenant" = "sm"."tenant"');
  });
});

function makeQueryBuilder<T>(result: T[]) {
  const builder = {
    joinRaw: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn(async () => result),
  };
  return builder;
}

function makeBillingSettingsQuery(currencyCode: string | null) {
  return {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    first: vi.fn(async () => (
      currencyCode ? { default_currency_code: currencyCode } : undefined
    )),
  };
}

function makeReportTransaction({
  currencyCode,
  groupedRows = [],
}: {
  currencyCode: string | null;
  groupedRows?: Array<Record<string, unknown>>;
}) {
  const trx = vi.fn((tableName: string) => {
    if (tableName === 'stock_movements as sm') {
      return makeQueryBuilder(groupedRows);
    }
    if (tableName === 'default_billing_settings') {
      return makeBillingSettingsQuery(currencyCode);
    }
    throw new Error(`Unexpected table ${tableName}`);
  });
  return Object.assign(trx, {
    raw: vi.fn((sql: string) => sql),
  });
}

describe('marginReport currency', () => {
  const TENANT = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
    withTransactionMock.mockImplementation(async (knex, callback) => callback(knex));
  });

  it('returns the tenant default billing currency', async () => {
    const trx = makeReportTransaction({
      currencyCode: 'EUR',
      groupedRows: [
        {
          service_id: 'service-1',
          service_name: 'Router',
          sku: 'RTR-1',
          qty_sold: '2',
          revenue_cents: '30000',
          cogs_cents: '12000',
        },
      ],
    });
    createTenantKnexMock.mockResolvedValue({ knex: trx });

    const report = await (marginReport as any)(
      { user_id: 'user-1' },
      { tenant: TENANT },
      {},
    );

    expect(report).toMatchObject({
      currency_code: 'EUR',
      total_revenue_cents: 30000,
      total_cogs_cents: 12000,
      total_margin_cents: 18000,
    });
  });

  it('falls back to USD when billing settings do not exist', async () => {
    const trx = makeReportTransaction({ currencyCode: null });
    createTenantKnexMock.mockResolvedValue({ knex: trx });

    const report = await (marginReport as any)(
      { user_id: 'user-1' },
      { tenant: TENANT },
      {},
    );

    expect(report.currency_code).toBe('USD');
  });
});
