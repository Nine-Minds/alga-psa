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

describe('invoice service manual invoice tenant-scoped query contract', () => {
  it('uses structural tenant scoping for manual invoice post-create reloads', () => {
    const manualSection = sectionBetween('async generateManualInvoice', 'async generatePDF');

    expect(manualSection).toContain('tenantDb(');
    expect(manualSection).toContain(".table('invoices')");
    expect(manualSection).toContain(".table('invoice_charges')");
    expect(manualSection).toContain("await trx('invoices').insert({");

    expect(manualSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|first)/);
    expect(manualSection).not.toMatch(/trx\('invoice_charges'\)\s*\.(?:where|orderBy)/);
    expect(manualSection).not.toMatch(/\.where\(\{\s*invoice_id: invoiceId,\s*tenant\s*\}\)/);
  });
});
