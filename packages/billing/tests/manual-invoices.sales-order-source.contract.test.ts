import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('manual invoice sales-order source wiring', () => {
  it('routes selected sales orders through the sales-order invoice bridge', () => {
    const source = read('../src/components/billing-dashboard/ManualInvoices.tsx');

    expect(source).toContain('generateInvoiceForSalesOrder');
    expect(source).toContain('manual-invoice-sales-order-source');
    expect(source).toContain('manual-invoice-sales-order-context');
    expect(source).toContain('manual-invoice-sales-order-client');
    expect(source).toContain('Generate Sales Order Invoice');
    expect(source).toContain('router.push(`/msp/billing?tab=invoicing&subtab=drafts&invoiceId=${result.invoiceId}`)');
  });

  it('keeps freeform manual invoice controls out of sales-order source mode', () => {
    const source = read('../src/components/billing-dashboard/ManualInvoices.tsx');

    expect(source).toContain('!hasSalesOrderSource && (');
    expect(source).toContain('id="new-invoice-number-input"');
    expect(source).toContain('id="is-prepayment"');
    expect(source).toContain("id='add-line-item-button'");
  });
});
