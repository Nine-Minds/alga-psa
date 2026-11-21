/**
 * alga-2026-0003122: when tax is delegated to the accounting system, fixed-plan
 * allocation rows must follow their parent charge so accounting export expansion
 * can reconcile the two levels. Knex is faked; no database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type DetailRow = {
  item_detail_id: string;
  allocated_amount: number;
  parent_item_id: string;
  parent_net_amount: number;
  parent_tax_amount: number;
};

const state = vi.hoisted(() => ({
  details: [] as any[],
  updates: [] as Array<{ table: string; where: any[]; patch: Record<string, unknown> }>,
  joins: [] as string[],
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: (table: string) => {
      const where: any[] = [];
      const query: any = {};
      for (const method of ['where', 'whereIn'] as const) {
        query[method] = (...args: any[]) => {
          where.push([method, ...args]);
          return query;
        };
      }
      query.orderBy = () => query;
      query.select = () => query;
      query.update = async (patch: Record<string, unknown>) => {
        state.updates.push({ table, where, patch });
        return 1;
      };
      query.then = (resolve: any, reject: any) => Promise.resolve(state.details).then(resolve, reject);
      return query;
    },
    tenantJoin: (_query: unknown, tableExpression: string) => {
      state.joins.push(tableExpression);
    },
  })),
}));

import {
  allocateCentsByWeight,
  distributeExternalTaxToFixedDetails,
  zeroFixedDetailTaxForInvoice,
} from '../src/services/delegatedFixedDetailTax';

const TENANT = 'tenant-1';
const INVOICE = 'inv-1';
const knex = {} as any;

function detail(overrides: Partial<DetailRow>): DetailRow {
  return {
    item_detail_id: 'detail-1',
    allocated_amount: 25_000,
    parent_item_id: 'charge-1',
    parent_net_amount: 93_000,
    parent_tax_amount: 0,
    ...overrides,
  };
}

describe('allocateCentsByWeight', () => {
  it('splits proportionally and parks the remainder on the last positive weight', () => {
    expect(allocateCentsByWeight(2_501, [25_000, 34_000, 34_000])).toEqual([672, 914, 915]);
    expect(allocateCentsByWeight(2_501, [25_000, 34_000, 34_000]).reduce((a, b) => a + b, 0)).toBe(2_501);
  });

  it('gives a single allocation the whole amount', () => {
    expect(allocateCentsByWeight(2_501, [93_000])).toEqual([2_501]);
  });

  it('gives nothing to non-positive weights', () => {
    expect(allocateCentsByWeight(1_000, [0, 5_000, -200, 5_000])).toEqual([0, 500, 0, 500]);
  });

  it('keeps the sum exact when no weight is positive or the total is zero', () => {
    expect(allocateCentsByWeight(300, [0, 0])).toEqual([0, 300]);
    expect(allocateCentsByWeight(0, [25_000, 68_000])).toEqual([0, 0]);
    expect(allocateCentsByWeight(500, [])).toEqual([]);
  });

  it('handles a credited (negative) total without losing cents', () => {
    const shares = allocateCentsByWeight(-2_501, [25_000, 68_000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(-2_501);
  });
});

describe('fixed-detail tax normalisation for delegated invoices', () => {
  beforeEach(() => {
    state.details = [];
    state.updates = [];
    state.joins = [];
  });

  it('zeroes tax amount and rate on every allocation of a pending_external invoice', async () => {
    state.details = [
      detail({ item_detail_id: 'detail-1' }),
      detail({ item_detail_id: 'detail-2', allocated_amount: 68_000 }),
    ];

    const touched = await zeroFixedDetailTaxForInvoice(knex, TENANT, INVOICE);

    expect(touched).toBe(2);
    expect(state.updates).toEqual([
      {
        table: 'invoice_charge_fixed_details',
        where: [['whereIn', 'item_detail_id', ['detail-1', 'detail-2']]],
        patch: { tax_amount: 0, tax_rate: 0 },
      },
    ]);
    // The join chain stays tenant-scoped through charge details and charges.
    expect(state.joins).toEqual(['invoice_charge_fixed_details as iifd', 'invoice_charges as ic']);
  });

  it('does nothing when the invoice has no fixed-plan allocations', async () => {
    expect(await zeroFixedDetailTaxForInvoice(knex, TENANT, INVOICE)).toBe(0);
    expect(await distributeExternalTaxToFixedDetails(knex, TENANT, INVOICE)).toBe(0);
    expect(state.updates).toEqual([]);
  });

  it('splits an odd imported tax so the allocations sum to the parent exactly', async () => {
    state.details = [
      detail({ item_detail_id: 'detail-1', allocated_amount: 25_000, parent_tax_amount: 2_501 }),
      detail({ item_detail_id: 'detail-2', allocated_amount: 34_000, parent_tax_amount: 2_501 }),
      detail({ item_detail_id: 'detail-3', allocated_amount: 34_000, parent_tax_amount: 2_501 }),
    ];

    const updated = await distributeExternalTaxToFixedDetails(knex, TENANT, INVOICE);

    expect(updated).toBe(3);
    const shares = state.updates.map((update) => update.patch.tax_amount as number);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(2_501);
    // Each allocation records the parent's effective (blended) rate.
    expect(state.updates.every((update) => update.patch.tax_rate === 2.689247)).toBe(true);
    expect(state.updates.map((update) => update.where)).toEqual([
      [['where', 'item_detail_id', 'detail-1']],
      [['where', 'item_detail_id', 'detail-2']],
      [['where', 'item_detail_id', 'detail-3']],
    ]);
  });

  it('distributes each parent independently and zeroes a parent with no imported tax', async () => {
    state.details = [
      detail({ item_detail_id: 'a1', parent_item_id: 'charge-1', allocated_amount: 25_000, parent_net_amount: 93_000, parent_tax_amount: 9_300 }),
      detail({ item_detail_id: 'a2', parent_item_id: 'charge-1', allocated_amount: 68_000, parent_net_amount: 93_000, parent_tax_amount: 9_300 }),
      detail({ item_detail_id: 'b1', parent_item_id: 'charge-2', allocated_amount: 10_000, parent_net_amount: 10_000, parent_tax_amount: 0 }),
    ];

    await distributeExternalTaxToFixedDetails(knex, TENANT, INVOICE);

    const byDetail = new Map(state.updates.map((update) => [update.where[0][2] as string, update.patch]));
    expect(byDetail.get('a1')).toEqual({ tax_amount: 2_500, tax_rate: 10 });
    expect(byDetail.get('a2')).toEqual({ tax_amount: 6_800, tax_rate: 10 });
    expect(byDetail.get('b1')).toEqual({ tax_amount: 0, tax_rate: 0 });
  });

  it('keeps the sum exact when the parent has tax but no net amount', async () => {
    state.details = [
      detail({ item_detail_id: 'detail-1', allocated_amount: 0, parent_net_amount: 0, parent_tax_amount: 125 }),
      detail({ item_detail_id: 'detail-2', allocated_amount: 0, parent_net_amount: 0, parent_tax_amount: 125 }),
    ];

    await distributeExternalTaxToFixedDetails(knex, TENANT, INVOICE);

    expect(state.updates.map((update) => update.patch)).toEqual([
      { tax_amount: 0, tax_rate: 0 },
      { tax_amount: 125, tax_rate: 0 },
    ]);
  });
});
