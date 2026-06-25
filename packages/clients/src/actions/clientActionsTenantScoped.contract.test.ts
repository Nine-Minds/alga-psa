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
});
