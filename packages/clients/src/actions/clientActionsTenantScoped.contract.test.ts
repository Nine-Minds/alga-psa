import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

const source = readFileSync(path.resolve(__dirname, 'clientActions.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('clientActions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for top-level cleanup, update, and create roots', () => {
    const entraCleanupSection = sectionBetween('async function cleanupEntraReferencesBeforeClientDelete', 'export const updateClient');
    const updateSection = sectionBetween('export const updateClient', 'export const createClient');
    const createSection = sectionBetween('export const createClient', '// Pagination interface');

    expect(source).toContain("import { createTenantKnex, createTenantScopedQuery, withTransaction } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');

    expect(entraCleanupSection).toContain("tenantScopedTable(trx, 'entra_sync_run_tenants', tenantId)");
    expect(entraCleanupSection).toContain("tenantScopedTable(trx, 'entra_contact_links', tenantId)");
    expect(entraCleanupSection).toContain("tenantScopedTable(trx, 'entra_contact_reconciliation_queue', tenantId)");
    expect(entraCleanupSection).toContain("tenantScopedTable(trx, 'entra_client_tenant_mappings', tenantId)");
    expect(entraCleanupSection).not.toContain(".where({ tenant: tenantId, client_id: clientId })");
    expect(entraCleanupSection).not.toContain('tenant: tenantId,\n        client_id: clientId');

    expect(updateSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(updateSection).not.toContain(".where({ client_id: clientId, tenant })");
    expect(updateSection).not.toContain("trx<IClient>('clients')");

    expect(createSection).toContain("tenantScopedTable(knex, 'default_billing_settings', tenant)");
    expect(createSection).not.toContain("knex('default_billing_settings')");
    expect(createSection).not.toContain(".where({ tenant })");
  });

  it('uses structural tenant scoping for paginated client list roots', () => {
    const defaultLocationSection = sectionBetween('function buildDefaultClientLocationSubquery', 'export const getAllClientsPaginated');
    const paginatedSection = sectionBetween('export const getAllClientsPaginated', 'export const getClientsWithBillingCycleRangePaginated');
    const billingRangeSection = sectionBetween('export const getClientsWithBillingCycleRangePaginated', 'export const validateClientDeletion');

    expect(defaultLocationSection).toContain("tenantScopedTable(trx, 'client_locations', tenant)");
    expect(defaultLocationSection).not.toContain('.where({ tenant, is_default: true })');

    expect(paginatedSection).toContain("tenantScopedTable(trx, 'clients as c', tenant)");
    expect(paginatedSection).toContain("tenantScopedTable(trx, 'tag_mappings as tm', tenant)");
    expect(paginatedSection).not.toContain("trx('clients as c')");
    expect(paginatedSection).not.toContain(".where({ 'c.tenant': tenant })");
    expect(paginatedSection).not.toContain(".where('tm.tenant', tenant)");

    expect(billingRangeSection).toContain("tenantScopedTable(trx, 'clients as c', tenant)");
    expect(billingRangeSection).toContain("tenantScopedTable(trx, 'tag_mappings as tm', tenant)");
    expect(billingRangeSection).toContain("tenantScopedTable(trx, 'client_billing_cycles as cbc', tenant)");
    expect(billingRangeSection).not.toContain("trx('clients as c')");
    expect(billingRangeSection).not.toContain(".where({ 'c.tenant': tenant })");
    expect(billingRangeSection).not.toContain(".where('tm.tenant', tenant)");
    expect(billingRangeSection).not.toContain(".where('cbc.tenant', tenant)");
  });

  it('uses structural tenant scoping for client deletion roots', () => {
    const validateDeleteSection = sectionBetween('export const validateClientDeletion', 'function tailorClientDeleteAlternatives');
    const deleteSection = sectionBetween('export const deleteClient', 'export const exportClientsToCSV');

    expect(validateDeleteSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(validateDeleteSection).toContain("tenantScopedTable(trx, 'tenant_companies', tenant)");
    expect(validateDeleteSection).not.toContain("trx('clients')");
    expect(validateDeleteSection).not.toContain("trx('tenant_companies')");
    expect(validateDeleteSection).not.toContain('.where({ client_id: clientId, tenant })');
    expect(validateDeleteSection).not.toContain('tenant,\n        is_default: true');

    expect(deleteSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'tenant_companies', tenant)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'client_tax_settings', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'client_tax_rates', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'client_contracts', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'client_billing_cycles', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'client_billing_settings', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'client_payment_customers', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'client_locations', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'document_block_content', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'document_associations', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'documents', tenantId)");
    expect(deleteSection).not.toContain(".where({ client_id: clientId, tenant })");
    expect(deleteSection).not.toContain('tenant,\n          is_default: true');
    expect(deleteSection).not.toContain('tenant: tenantId');
    expect(deleteSection).not.toContain("trx('client_tax_settings')");
    expect(deleteSection).not.toContain("trx('document_block_content')");
  });
});
