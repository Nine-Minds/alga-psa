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
const preManualChargeSection = sectionBetween(
  'export async function getClientDetails',
  'export async function persistManualInvoiceCharges'
);
const manualChargeSection = sectionBetween(
  'export async function persistManualInvoiceCharges',
  'async function persistFixedInvoiceCharges'
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

  it('uses structural tenant scoping for client helpers and percentage discount recalculation roots', () => {
    expect(preManualChargeSection).toContain("tenantScopedTable(knex, tenant, 'clients as c')");
    expect(preManualChargeSection).toContain("tenantScopedTable(knex, tenant, 'client_locations')");
    expect(preManualChargeSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charges')");

    expect(preManualChargeSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(preManualChargeSection).not.toMatch(/\.where\(['"]tenant['"]/);
    expect(preManualChargeSection).not.toContain("knex('clients as c')");
    expect(preManualChargeSection).not.toContain("knex('client_locations')");
    expect(preManualChargeSection).not.toContain("tx('invoice_charges')");
  });

  it('uses structural tenant scoping for manual invoice lookup roots', () => {
    expect(manualChargeSection).toContain("tenantScopedTable(tx, tenant, 'service_catalog')");
    expect(manualChargeSection).toContain("tenantScopedTable(tx, tenant, 'tax_rates')");
    expect(manualChargeSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charges')");

    expect(manualChargeSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(manualChargeSection).not.toMatch(/\.where\(['"]tenant['"]/);
    expect(manualChargeSection).not.toContain("tx('service_catalog')");
    expect(manualChargeSection).not.toContain("tx('tax_rates')");
    expect(manualChargeSection).not.toContain("const applicableItem = await tx('invoice_charges')");
  });
});
