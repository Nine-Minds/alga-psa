import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../../../packages/billing/src/services/invoiceService.ts',
  ),
  'utf8',
);

function sectionBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

const linkageSection = sectionBetween(
  'async function linkRecurringServicePeriodToInvoiceDetail',
  'function getRecurringChargeFamilyForInvoiceLinkage'
);

describe('invoiceService tenant-scoped query contract', () => {
  it('uses structural tenant scoping for top invoice linkage and source-marking roots', () => {
    expect(source).toContain("import { createTenantKnex, createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain(
      'function tenantScopedTable(knexOrTrx: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder'
    );
    expect(source).toContain('createTenantScopedQuery(knexOrTrx, { table, tenant }).builder');

    expect(linkageSection).toContain("tenantScopedTable(tx, tenant, 'invoices')");
    expect(linkageSection).toContain("tenantScopedTable(tx, tenant, 'contract_line_service_configuration')");
    expect(linkageSection).toContain("tenantScopedTable(tx, tenant, 'recurring_service_periods')");
    expect(linkageSection).toContain("tenantScopedTable(tx, tenant, 'time_entries')");
    expect(linkageSection).toContain("tenantScopedTable(tx, tenant, 'usage_tracking')");

    expect(linkageSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(linkageSection).not.toMatch(/\.where\(['"]tenant['"]/);
    expect(linkageSection).not.toContain("tx('invoices')");
    expect(linkageSection).not.toContain("tx('contract_line_service_configuration')");
    expect(linkageSection).not.toContain("tx('recurring_service_periods')");
    expect(linkageSection).not.toContain("tx('time_entries')");
    expect(linkageSection).not.toContain("tx('usage_tracking')");
  });
});
