import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createPurchaseOrderDraftCore } from './purchaseOrders';

function fakeTransaction() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

  class Query {
    private row: Record<string, any> | null = null;

    constructor(private readonly table: string) {}

    where(): this { return this; }
    select(): this { return this; }

    async first(): Promise<Record<string, unknown> | undefined> {
      if (this.table === 'vendors') return { vendor_id: 'vendor-1', vendor_name: 'Vendor One' };
      if (this.table === 'vendor_products') return undefined;
      return undefined;
    }

    insert(row: Record<string, any>): this {
      this.row = row;
      inserts.push({ table: this.table, row });
      return this;
    }

    async returning(): Promise<Record<string, unknown>[]> {
      if (!this.row) return [];
      if (this.table === 'purchase_orders') return [{ po_id: 'po-1', ...this.row }];
      if (this.table === 'purchase_order_lines') {
        return [{ po_line_id: `line-${inserts.filter((insert) => insert.table === this.table).length}`, ...this.row }];
      }
      return [this.row];
    }
  }

  const trx = ((table: string) => new Query(table)) as unknown as Knex.Transaction;
  (trx as any).fn = { now: () => '2026-07-16T12:00:00.000Z' };
  (trx as any).raw = vi.fn(async () => ({ rows: [{ number: 'PO-1042' }] }));
  return { trx, inserts };
}

describe('purchase order draft core', () => {
  it('T062: uses next-number generation and creates a draft header plus lines', async () => {
    const { trx, inserts } = fakeTransaction();
    const result = await createPurchaseOrderDraftCore(trx, 'tenant-1', 'publisher-1', {
      vendor_id: 'vendor-1',
      currency_code: 'USD',
      ship_to_location_id: 'location-1',
      lines: [
        { service_id: 'service-1', quantity_ordered: 2, unit_cost: 1250 },
        { service_id: 'service-2', quantity_ordered: 1, unit_cost: 750 },
      ],
    });

    expect((trx.raw as any)).toHaveBeenCalledWith(
      'SELECT generate_next_number(?::uuid, ?) as number',
      ['tenant-1', 'PURCHASE_ORDER'],
    );
    expect(inserts.find((insert) => insert.table === 'purchase_orders')?.row).toMatchObject({
      tenant: 'tenant-1',
      po_number: 'PO-1042',
      vendor_id: 'vendor-1',
      status: 'draft',
      ship_to_location_id: 'location-1',
      currency_code: 'USD',
      created_by: 'publisher-1',
    });
    expect(inserts.filter((insert) => insert.table === 'purchase_order_lines')).toHaveLength(2);
    expect(result.purchase_order).toMatchObject({
      po_id: 'po-1',
      po_number: 'PO-1042',
      status: 'draft',
      lines: [
        expect.objectContaining({ service_id: 'service-1', quantity_ordered: 2, unit_cost: 1250 }),
        expect.objectContaining({ service_id: 'service-2', quantity_ordered: 1, unit_cost: 750 }),
      ],
    });
    expect(result.purchase_order_created_event).toEqual({
      tenant: 'tenant-1',
      po_id: 'po-1',
      user_id: 'publisher-1',
    });
  });
});
