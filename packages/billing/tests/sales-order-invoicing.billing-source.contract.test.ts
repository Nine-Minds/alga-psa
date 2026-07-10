import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../src/actions/salesOrderInvoicingActions.ts'),
    'utf8',
  );
}

describe('sales order invoicing billing source contract', () => {
  it('exposes invoiceable sales orders using the same billing modes as invoice generation', () => {
    const source = readSource();

    expect(source).toContain('export const listInvoiceableSalesOrdersForBilling');
    expect(source).toContain("hasPermission(user, 'sales_order', 'read')");
    expect(source).toContain("so.invoice_mode = 'manual'");
    expect(source).toContain('COALESCE(sol.quantity_ordered, 0) - COALESCE(sol.quantity_invoiced, 0)');
    expect(source).toContain('LEAST(COALESCE(sol.quantity_fulfilled, 0), COALESCE(sol.quantity_ordered, 0))');
    expect(source).toContain(".whereNotIn('so.status', ['draft', 'cancelled'])");
    expect(source).toContain('billable_amount');
  });
});
