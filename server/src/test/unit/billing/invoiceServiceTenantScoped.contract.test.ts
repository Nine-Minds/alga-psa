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
const taxReadSection = sectionBetween(
  'export async function calculateAndDistributeTax',
  '// 6. Update Detail and Item Tables'
);
const taxWriteSection = sectionBetween(
  '// 6. Update Detail and Item Tables',
  'export async function updateInvoiceTotalsAndRecordTransaction'
);
const totalUpdateSection = sectionBetween(
  'export async function updateInvoiceTotalsAndRecordTransaction',
  'await tx(\'transactions\').insert'
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

  it('uses structural tenant scoping for invoice tax read and hydration roots', () => {
    expect(taxReadSection).toContain("tenantScopedTable(tx, tenant, 'invoices')");
    expect(taxReadSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charges')");
    expect(taxReadSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charge_details')");
    expect(taxReadSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charge_fixed_details as iifd')");

    expect(taxReadSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(taxReadSection).not.toMatch(/\.(?:where|andWhere)\(['"][^'"]*tenant['"]/);
    expect(taxReadSection).not.toContain("tx('invoices')");
    expect(taxReadSection).not.toContain("tx('invoice_charges')");
    expect(taxReadSection).not.toContain("tx('invoice_charge_details')");
    expect(taxReadSection).not.toContain("tx('invoice_charge_fixed_details as iifd')");
  });

  it('uses structural tenant scoping for invoice tax writeback and total update roots', () => {
    expect(taxWriteSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charge_fixed_details')");
    expect(taxWriteSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charges')");
    expect(taxWriteSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charge_fixed_details as iifd')");
    expect(totalUpdateSection).toContain("tenantScopedTable(tx, tenant, 'invoice_charges')");
    expect(totalUpdateSection).toContain("tenantScopedTable(tx, tenant, 'invoices')");
    expect(totalUpdateSection).toContain("tenantScopedTable(tx, tenant, 'transactions')");

    expect(taxWriteSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(taxWriteSection).not.toMatch(/\.(?:where|andWhere)\(['"][^'"]*tenant['"]/);
    expect(totalUpdateSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(totalUpdateSection).not.toMatch(/\.(?:where|andWhere)\(['"][^'"]*tenant['"]/);
  });

  it('has no remaining direct tenant root predicates in invoiceService', () => {
    expect(source).toContain("tenantScopedTable(tx, tenant, 'contract_lines as cl')");
    expect(source).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(source).not.toMatch(/\.(?:where|andWhere)\(['"][^'"]*tenant['"]/);
  });
});
