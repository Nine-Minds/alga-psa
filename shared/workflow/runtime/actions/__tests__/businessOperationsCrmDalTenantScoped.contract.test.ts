import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../businessOperations/crmWorkerDal.ts'), 'utf8');
// The worker's quote tax comes from the shared engine; its tax reads are pinned there.
const engineSource = readFileSync(resolve(__dirname, '../../../../billingClients/taxEngine.ts'), 'utf8');

function sectionBetween(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return text.slice(start, end);
}

function expectNoRawTenantFilters(text: string): void {
  expect(text).not.toMatch(/\.where\(\{\s*tenant[,}]/);
  expect(text).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
  expect(text).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
}

describe('CRM workflow DAL tenant-scoped query contract', () => {
  it('uses structural tenant scoping for quote financial helper roots and carries no tax copy', () => {
    const section = sectionBetween(source, 'async function recalculateQuoteFinancials', 'export const QuoteActivity');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(knexOrTrx, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');

    expect(source).toContain("from '../../../../billingClients/taxEngine'");
    expect(source).not.toContain('async function calculateTaxWithConnection');
    expect(section).not.toContain("'tax_rates'");
    expect(section).not.toContain("'client_tax_rates'");
    expect(section).not.toContain("'tax_rate_thresholds'");
    expect(section).not.toContain("'tax_holidays'");

    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'quotes')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'quote_items')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'clients')");
    expect(section).toContain("tenantScopedTable(knexOrTrx, tenant, 'client_locations')");
    expect(section).not.toContain('TENANTLESS_TAX_CHILD_REASON');
    expectNoRawTenantFilters(section);
  });

  it('the shared tax engine the worker imports scopes every tax read structurally', () => {
    expect(engineSource).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(engineSource).not.toContain('createTenantScopedQuery');
    expect(engineSource).toContain(".table('clients')");
    expect(engineSource).toContain(".table<IClientTaxSettings>('client_tax_settings')");
    expect(engineSource).toContain(".table('tax_rates')");
    expect(engineSource).toContain(".table('client_tax_rates')");
    expect(engineSource).toContain(".parentScopedTable<ITaxComponent>('composite_tax_mappings as ctm')");
    expect(engineSource).toContain("facade.tenantJoin(componentsQuery, 'tax_components as tc'");
    expect(engineSource).toContain(".parentScopedTable<ITaxRateThreshold>('tax_rate_thresholds')");
    expect(engineSource).toContain(".parentScopedTable<ITaxHoliday>('tax_holidays')");
    expect(engineSource).not.toContain('TENANTLESS_TAX_CHILD_REASON');
    expect(engineSource).not.toContain("knexOrTrx('tax_holidays')");
    expect(engineSource).not.toContain("knexOrTrx('tax_rate_thresholds')");
    expectNoRawTenantFilters(engineSource);
  });
});
