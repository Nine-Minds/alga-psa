/**
 * Fixed-plan expansion for invoices whose tax is delegated to the accounting
 * system (alga-2026-0003122). A pending_external invoice carries 0 tax on both
 * levels, so its child export lines are net-only; once tax is imported the
 * children carry their share of the parent's imported tax. The strict equality
 * check stays, but its message must name the invoice and both sums.
 *
 * Knex is faked; no database.
 */
import { describe, expect, it, vi } from 'vitest';

type FakeRows = Record<string, any[]>;

function createFakeKnex(rows: FakeRows) {
  const knex: any = (table: string) => {
    const builder: any = {};
    for (const method of ['where', 'andWhere', 'whereIn', 'select', 'orderBy']) {
      builder[method] = () => builder;
    }
    builder.first = async () => rows[table]?.[0];
    builder.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve(rows[table] ?? []).then(onFulfilled, onRejected);
    return builder;
  };
  knex.schema = { hasTable: vi.fn(async () => false) };
  return knex;
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn((knex: any) => ({
    table: (table: string) => knex(table),
    tenantJoin: () => undefined,
  })),
}));

import { expandAccountingExportCharges } from '../../src/services/accountingExportChargeExpansion';

const TENANT = 'tenant-1';

function parentCharge(overrides: Record<string, unknown> = {}) {
  return {
    item_id: 'charge-1',
    invoice_id: 'inv-1',
    service_id: null,
    is_manual: false,
    is_discount: false,
    net_amount: 93_000,
    tax_amount: 0,
    ...overrides,
  };
}

function exportLine(overrides: Record<string, unknown> = {}) {
  return {
    line_id: 'line-1',
    document_id: 'inv-1',
    document_line_id: 'charge-1',
    amount_cents: 93_000,
    payload: {},
    ...overrides,
  } as any;
}

describe('expandAccountingExportCharges with delegated tax', () => {
  it('expands a pending_external fixed-plan parent into net-only child lines', async () => {
    const knex = createFakeKnex({
      'invoice_charge_details as d': [
        { item_id: 'charge-1', item_detail_id: 'detail-1', service_id: 'svc-1', allocated_amount: 25_000, tax_amount: 0 },
        { item_id: 'charge-1', item_detail_id: 'detail-2', service_id: 'svc-2', allocated_amount: 68_000, tax_amount: 0 },
      ],
    });
    const charges = new Map([['charge-1', parentCharge()]]);

    const expanded = await expandAccountingExportCharges(knex, TENANT, charges as any, [exportLine()]);

    expect(expanded.lines.map((line) => [line.document_line_id, line.amount_cents])).toEqual([
      ['detail-1', 25_000],
      ['detail-2', 68_000],
    ]);
    expect(expanded.lines.map((line) => line.payload?.metadata?.allocation_parent_charge_id)).toEqual([
      'charge-1',
      'charge-1',
    ]);
    expect(expanded.charges.get('detail-1')).toMatchObject({ net_amount: 25_000, tax_amount: 0, total_price: 25_000 });
    expect(expanded.charges.get('detail-2')).toMatchObject({ net_amount: 68_000, tax_amount: 0, total_price: 68_000 });
  });

  it('carries the imported tax share on each child once tax is external', async () => {
    const knex = createFakeKnex({
      'invoice_charge_details as d': [
        { item_id: 'charge-1', item_detail_id: 'detail-1', service_id: 'svc-1', allocated_amount: 25_000, tax_amount: 672 },
        { item_id: 'charge-1', item_detail_id: 'detail-2', service_id: 'svc-2', allocated_amount: 68_000, tax_amount: 1_829 },
      ],
    });
    const charges = new Map([['charge-1', parentCharge({ tax_amount: 2_501 })]]);

    const expanded = await expandAccountingExportCharges(knex, TENANT, charges as any, [exportLine()]);

    expect(expanded.lines.map((line) => line.amount_cents)).toEqual([25_672, 69_829]);
    expect(expanded.charges.get('detail-2')).toMatchObject({ net_amount: 68_000, tax_amount: 1_829, total_price: 69_829 });
  });

  it('names the invoice and both sums when the two levels disagree', async () => {
    const knex = createFakeKnex({
      'invoice_charge_details as d': [
        { item_id: 'charge-1', item_detail_id: 'detail-1', service_id: 'svc-1', allocated_amount: 25_000, tax_amount: 2_500 },
        { item_id: 'charge-1', item_detail_id: 'detail-2', service_id: 'svc-2', allocated_amount: 68_000, tax_amount: 6_800 },
      ],
      invoices: [{ invoice_id: 'inv-1', invoice_number: 'INV-000013' }],
    });
    const charges = new Map([['charge-1', parentCharge()]]);

    await expect(expandAccountingExportCharges(knex, TENANT, charges as any, [exportLine()])).rejects.toThrow(
      'Fixed-plan allocation totals do not match charge charge-1 on invoice INV-000013: '
      + 'parent net 93000 / tax 0, allocations net 93000 / tax 9300; repair the invoice before export.'
    );
  });

  it('falls back to the charge lookup for the invoice label when the projection omits invoice_id', async () => {
    const knex = createFakeKnex({
      'invoice_charge_details as d': [
        { item_id: 'charge-1', item_detail_id: 'detail-1', service_id: 'svc-1', allocated_amount: 24_000, tax_amount: 0 },
      ],
      invoice_charges: [{ item_id: 'charge-1', invoice_id: 'inv-1' }],
      invoices: [{ invoice_id: 'inv-1', invoice_number: 'INV-000011' }],
    });
    const charges = new Map([['charge-1', parentCharge({ invoice_id: undefined })]]);

    await expect(expandAccountingExportCharges(knex, TENANT, charges as any, [exportLine()])).rejects.toThrow(
      /on invoice INV-000011: parent net 93000 \/ tax 0, allocations net 24000 \/ tax 0/
    );
  });
});
