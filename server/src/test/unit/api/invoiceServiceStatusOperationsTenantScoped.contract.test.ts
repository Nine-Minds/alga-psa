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

describe('invoice service status operation tenant-scoped query contract', () => {
  it('uses structural tenant scoping for finalize and send roots', () => {
    const statusSection = sectionBetween('async finalizeInvoice', 'async recordPayment');

    expect(statusSection).toContain('tenantDb(');
    expect(statusSection).toContain(".table('invoices')");
    expect(statusSection).toContain(".table('invoice_line_items')");
    expect(statusSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|update|first)/);
    expect(statusSection).not.toMatch(/trx\('invoice_line_items'\)\s*\.(?:where|first)/);
    expect(statusSection).not.toMatch(/\.where\(\{\s*invoice_id: data\.invoice_id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
