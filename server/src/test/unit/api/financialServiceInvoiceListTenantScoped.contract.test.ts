import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/FinancialService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('financial service invoice list tenant-scoped query contract', () => {
  it('uses structural tenant scoping for invoice list roots', () => {
    const invoiceSection = sectionBetween('async listInvoices', '// CREDIT MANAGEMENT');

    expect(invoiceSection).toContain('createTenantScopedQuery(knex, {');
    expect(invoiceSection).toContain("table: 'invoices as i'");
    expect(invoiceSection).toContain(".andOn('i.tenant', '=', 'c.tenant')");

    expect(invoiceSection).not.toMatch(/knex\('invoices as i'\)\s*\./);
    expect(invoiceSection).not.toMatch(/\.where\('i\.tenant', context\.tenant\)/);
  });
});
