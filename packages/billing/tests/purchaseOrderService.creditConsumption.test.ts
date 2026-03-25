import { describe, expect, it, vi } from 'vitest';
import { getPurchaseOrderConsumedCents } from '../src/services/purchaseOrderService';

function buildInvoiceQuery(result: { sum?: string | number | null }) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.andWhereNot = vi.fn(() => builder);
  builder.andWhere = vi.fn((arg: any) => {
    if (typeof arg === 'function') {
      const callbackBuilder = {
        whereNotNull: vi.fn(() => callbackBuilder),
        orWhereIn: vi.fn(() => callbackBuilder),
      };
      arg(callbackBuilder);
    }
    return builder;
  });
  builder.select = vi.fn(() => builder);
  builder.first = vi.fn().mockResolvedValue(result);
  return builder;
}

describe('purchaseOrderService credit-aware PO consumption', () => {
  it('T099: subtracts applied credits from finalized PO consumption before overage checks', async () => {
    const invoiceQuery = buildInvoiceQuery({ sum: '7500' });
    const raw = vi.fn((sql: string) => sql);
    const knex: any = vi.fn((table: string) => {
      expect(table).toBe('invoices');
      return invoiceQuery;
    });
    knex.raw = raw;

    const consumed = await getPurchaseOrderConsumedCents({
      knex,
      tenant: 'tenant-1',
      clientContractId: 'assignment-1',
    });

    expect(consumed).toBe(7500);
    expect(raw).toHaveBeenCalledWith(
      'COALESCE(SUM(COALESCE(total_amount, 0) - COALESCE(credit_applied, 0)), 0) as sum'
    );
    expect(invoiceQuery.where).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      client_contract_id: 'assignment-1',
    });
  });

  it('floors aggregate PO consumption at zero when credits outweigh prior billed amounts', async () => {
    const invoiceQuery = buildInvoiceQuery({ sum: '-500' });
    const knex: any = vi.fn(() => invoiceQuery);
    knex.raw = vi.fn((sql: string) => sql);

    const consumed = await getPurchaseOrderConsumedCents({
      knex,
      tenant: 'tenant-1',
      clientContractId: 'assignment-1',
    });

    expect(consumed).toBe(0);
  });
});
