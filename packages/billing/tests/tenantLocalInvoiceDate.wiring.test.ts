import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../src', rel), 'utf8');

// Sales-order and hour-block invoicing run inside DB transactions that the unit
// harness cannot fake end-to-end; the Sydney-boundary behaviour itself is proven
// at the helper (packages/db workDate.test.ts) and the recurring/manual/preview
// paths. These contracts pin that the two paths take their date from the helper.
describe('tenant-local invoice date wiring', () => {
  it('sales-order invoicing resolves tenant-today once and reuses it for due date and invoice date', () => {
    const src = read('actions/salesOrderInvoicingActions.ts');
    expect(src.match(/resolveTenantToday\(/g)).toHaveLength(1);
    expect(src).toContain('getDueDate(header.client_id, invoiceDate)');
    expect(src).toContain('invoice_date: invoiceDate,');
    expect(src).not.toContain('Temporal.Now.plainDateISO()');
  });

  it('hour-block purchase derives due date and invoice date from one tenant-today value', () => {
    const src = read('actions/hourBlockActions.ts');
    expect(src).toContain('const currentDate = (await resolveTenantToday(trx, tenant)).toString();');
    expect(src).toContain('getDueDate(clientId, currentDate)');
    expect(src).toContain('invoiceDate: currentDate,');
    expect(src).toContain('invoice_date: invoiceDate ?? (await resolveTenantToday(trx, tenant)).toString(),');
    expect(src).not.toContain('Temporal.Now.plainDateISO()');
  });
});
