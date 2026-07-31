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

describe('invoice service PDF tenant-scoped query contract', () => {
  it('uses structural tenant scoping for PDF invoice lookup', () => {
    const pdfSection = sectionBetween('async generatePDF', 'async search');

    expect(pdfSection).toContain('tenantDb(');
    expect(pdfSection).toContain(".table('invoices')");
    expect(pdfSection).not.toMatch(/knex\('invoices'\)\s*\./);
    expect(pdfSection).not.toMatch(/\.where\(\{\s*invoice_id: id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
