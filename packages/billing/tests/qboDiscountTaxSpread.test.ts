import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Delegated tax: QuickBooks returns one invoice-level TotalTax computed on the
 * discounted base. fetchExternalInvoice must spread it by each line's
 * post-discount base so per-line tax matches what Alga stores when it is the
 * authority, and always sums to the external total.
 */
const harness = vi.hoisted(() => {
  const rows: Record<string, any[]> = {};
  const builder = (list: any[]) => {
    let selected = list;
    const qb: any = {};
    qb.select = () => qb;
    qb.where = (criteria: Record<string, unknown>) => {
      selected = selected.filter((row) => Object.entries(criteria).every(([k, v]) => row[k] === v));
      return qb;
    };
    qb.first = async () => selected[0] ?? null;
    qb.pluck = async (col: string) => selected.map((r) => r[col]);
    qb.then = (resolve: any, reject?: any) => Promise.resolve(selected).then(resolve, reject);
    return qb;
  };
  const knex: any = {};
  return { rows, knex, qboInvoice: { current: null as any }, builder };
});

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: harness.knex, tenant: 'tenant-x' })),
  tenantDb: vi.fn(() => ({ table: (name: string) => harness.builder(harness.rows[name] ?? []) })),
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn(async () => ({ read: vi.fn(async () => harness.qboInvoice.current) })) },
}));

import { QuickBooksOnlineAdapter } from '../src/adapters/accounting/quickBooksOnlineAdapter';

const qboLine = (id: string, amount: number) => ({
  Id: id,
  Amount: amount,
  DetailType: 'SalesItemLineDetail',
  SalesItemLineDetail: { TaxCodeRef: { value: 'TAX' } },
});

describe('QBO delegated tax spread with discounts', () => {
  beforeEach(() => {
    for (const key of Object.keys(harness.rows)) delete harness.rows[key];
    harness.rows.tenant_external_entity_mappings = [{
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: 'inv-1',
      external_entity_id: 'qbo-1',
      external_realm_id: 'realm',
      metadata: {
        chargeLineMappings: [
          { chargeId: 'a', qboLineId: '1' },
          { chargeId: 'b', qboLineId: '2' },
          { chargeId: 'd', qboLineId: '3' },
        ],
      },
    }];
  });

  it('spreads TotalTax by the discounted base when a discount targets one line', async () => {
    harness.rows.invoice_charges = [
      { invoice_id: 'inv-1', item_id: 'a', net_amount: 1000, is_discount: false, is_taxable: true },
      { invoice_id: 'inv-1', item_id: 'b', net_amount: 1000, is_discount: false, is_taxable: true },
      { invoice_id: 'inv-1', item_id: 'd', net_amount: -500, is_discount: true, applies_to_item_id: 'a' },
    ];
    // Base is 1500 at 10% -> 150.00 tax; line a carries 500, b carries 1000.
    harness.qboInvoice.current = {
      Id: 'qbo-1',
      CurrencyRef: { value: 'USD' },
      TotalAmt: 16.5,
      TxnTaxDetail: { TotalTax: 1.5 },
      Line: [qboLine('1', 10), qboLine('2', 10), qboLine('3', -5)],
    };
    const result = await new QuickBooksOnlineAdapter().fetchExternalInvoice('qbo-1', 'realm');
    expect(result.success).toBe(true);
    const tax = Object.fromEntries(result.invoice!.charges.map((c) => [c.lineId, c.taxAmount]));
    expect(tax).toEqual({ a: 50, b: 100, d: 0 });
  });

  it('keeps the sum exact for an untargeted discount and a three-way remainder', async () => {
    harness.rows.invoice_charges = [
      { invoice_id: 'inv-1', item_id: 'a', net_amount: 1000, is_discount: false, is_taxable: true },
      { invoice_id: 'inv-1', item_id: 'b', net_amount: 1000, is_discount: false, is_taxable: true },
      { invoice_id: 'inv-1', item_id: 'd', net_amount: -300, is_discount: true },
    ];
    harness.qboInvoice.current = {
      Id: 'qbo-1',
      CurrencyRef: { value: 'USD' },
      TotalAmt: 18.03,
      TxnTaxDetail: { TotalTax: 1.33 },
      Line: [qboLine('1', 10), qboLine('2', 10), qboLine('3', -3)],
    };
    const result = await new QuickBooksOnlineAdapter().fetchExternalInvoice('qbo-1', 'realm');
    const charges = result.invoice!.charges;
    expect(charges.reduce((s, c) => s + c.taxAmount, 0)).toBe(133);
    expect(charges.find((c) => c.lineId === 'd')!.taxAmount).toBe(0);
  });
});
