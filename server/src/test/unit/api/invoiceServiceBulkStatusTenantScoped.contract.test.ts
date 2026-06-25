import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/InvoiceService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('invoice service bulk status tenant-scoped query contract', () => {
  it('uses structural tenant scoping for bulk status read and update roots', () => {
    const bulkStatusSection = sectionBetween('async bulkUpdateStatus', 'async bulkSendInvoices');

    expect(bulkStatusSection).toContain('createTenantScopedQuery(trx, {');
    expect(bulkStatusSection).toContain("table: 'invoices'");
    expect(bulkStatusSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|update|first)/);
    expect(bulkStatusSection).not.toMatch(/\.where\(\{\s*invoice_id: invoiceId,\s*tenant: context\.tenant\s*\}\)/);
  });
});
