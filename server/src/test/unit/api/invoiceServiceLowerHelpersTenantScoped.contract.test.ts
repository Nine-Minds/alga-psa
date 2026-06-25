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

describe('invoice service lower helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for lower helper read roots', () => {
    const helperSection = sectionBetween('// Additional helper methods...', 'private async createInvoiceLineItems');

    expect(helperSection).toContain('tenantDb(');
    expect(helperSection).toContain(".table('invoices')");
    expect(helperSection).toContain(".table('clients as c')");
    expect(helperSection).toContain(".table('client_billing_cycles')");
    expect(helperSection).toContain(".table('tax_rates')");
    expect(helperSection).toContain(".table('invoice_payments')");
    expect(helperSection).toContain(".table('invoice_credits')");

    expect(helperSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|first)/);
    expect(helperSection).not.toMatch(/trx\('clients as c'\)\s*\./);
    expect(helperSection).not.toMatch(/trx\('client_billing_cycles'\)\s*\./);
    expect(helperSection).not.toMatch(/trx\('tax_rates'\)\s*\./);
    expect(helperSection).not.toMatch(/trx\('invoice_payments'\)\s*\.(?:where|orderBy)/);
    expect(helperSection).not.toMatch(/trx\('invoice_credits'\)\s*\.(?:where|orderBy)/);
    expect(helperSection).not.toMatch(/\.where\(\{\s*invoice_id: invoiceId,\s*tenant: context\.tenant\s*\}\)/);
  });
});
