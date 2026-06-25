import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../businessOperations/crmWorkerDal.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('CRM workflow DAL tenant-scoped query contract', () => {
  it('uses structural tenant scoping for quote tax and financial helper roots', () => {
    const section = sectionBetween('async function calculateTaxWithConnection', 'export const QuoteActivity');

    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('createTenantScopedQuery(knexOrTrx, { table, tenant }).builder');

    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'clients')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'client_tax_settings')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'tax_rates')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'client_tax_rates')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'tax_components')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'quotes')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'quote_items')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'client_locations')");

    expect(section).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(section).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
    expect(section).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
  });
});
