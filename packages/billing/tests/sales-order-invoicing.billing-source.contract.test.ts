import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../src/actions/salesOrderInvoicingActions.ts'),
    'utf8',
  );
}

/** Body of generateInvoiceForSalesOrder, up to the next top-level export. */
function readInvoiceActionBody(): string {
  const source = readSource();
  const start = source.indexOf('export const generateInvoiceForSalesOrder');
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
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

  // The invoice and the counters that record it must share one commit. When these were
  // three transactions, two concurrent calls both read quantity_invoiced=0 and both
  // billed the full quantity, while LEAST(...) capped the counter so the order still
  // looked invoiced exactly once.
  describe('generateInvoiceForSalesOrder atomicity', () => {
    it('bills inside a single transaction', () => {
      const body = readInvoiceActionBody();
      expect(body.match(/withTransaction\(/g) ?? []).toHaveLength(1);
    });

    it('locks the sales order header and lines before computing the billable delta', () => {
      const body = readInvoiceActionBody();
      const lockHeader = body.indexOf(
        "trx('sales_orders').where({ tenant, so_id: soId }).forUpdate().first()",
      );
      const lockLines = body.indexOf(
        "trx('sales_order_lines').where({ tenant, so_id: soId }).forUpdate()",
      );
      const computeDelta = body.indexOf('Number(l.quantity_invoiced)');

      expect(lockHeader).toBeGreaterThan(-1);
      expect(lockLines).toBeGreaterThan(lockHeader);
      expect(computeDelta).toBeGreaterThan(lockLines);
    });

    it('writes the invoice and the invoiced counters in the same transaction', () => {
      const body = readInvoiceActionBody();
      const persistCharges = body.indexOf('persistManualInvoiceCharges');
      const bumpCounters = body.indexOf('LEAST(quantity_ordered, quantity_invoiced + ?)');
      const commit = body.lastIndexOf('return {\n          success: true,');

      expect(persistCharges).toBeGreaterThan(-1);
      expect(bumpCounters).toBeGreaterThan(persistCharges);
      expect(commit).toBeGreaterThan(bumpCounters);
    });

    it('does not delegate to the manual-invoice action, which owns its own transaction', () => {
      expect(readSource()).not.toContain('generateManualInvoice');
    });

    it('requires a billing grant on both the create and append branches', () => {
      const body = readInvoiceActionBody();
      expect(body).toContain("const billingAction = existingDraft ? 'update' : 'create'");
      expect(body).toContain("hasPermission(user, 'billing', billingAction)");
    });

    it('locks an appendable draft so concurrent appends serialize on it', () => {
      const body = readInvoiceActionBody();
      const draftLookup = body.indexOf('const existingDraft');
      const draftLock = body.indexOf('.forUpdate()', draftLookup);
      const appendCharges = body.indexOf('persistManualInvoiceCharges', draftLookup);

      expect(draftLookup).toBeGreaterThan(-1);
      expect(draftLock).toBeGreaterThan(draftLookup);
      expect(appendCharges).toBeGreaterThan(draftLock);
    });
  });
});
