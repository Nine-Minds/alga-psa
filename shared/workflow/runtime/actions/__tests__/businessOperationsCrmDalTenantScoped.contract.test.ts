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

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(knexOrTrx, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');

    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'clients')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'client_tax_settings')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'tax_rates')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'client_tax_rates')");
    expect(section).toContain("facade.parentScopedTable('composite_tax_mappings as ctm')");
    expect(section).toContain("facade.tenantJoin(componentsQuery, 'tax_components as tc'");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'quotes')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'quote_items')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'client_locations')");
    expect(source).toContain(".parentScopedTable('tax_holidays')");
    expect(section).toContain(".parentScopedTable<TaxThresholdRow>('tax_rate_thresholds')");
    expect(section).not.toContain('TENANTLESS_TAX_CHILD_REASON');

    expect(section).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(section).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
    expect(section).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
    expect(section).not.toContain("knexOrTrx('tax_holidays')");
    expect(section).not.toContain("knexOrTrx('tax_rate_thresholds')");
  });
});
