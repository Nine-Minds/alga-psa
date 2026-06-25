import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../businessOperations/clients.ts'), 'utf8');

function sectionBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Unable to locate client workflow section: ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

const helperSection = sectionBetween(
  'async function ensureClientExists',
  'async function publishWorkflowDomainEvent'
);
const findSearchSection = sectionBetween(
  "id: 'clients.find'",
  "id: 'clients.create'"
);
const createUpdateArchiveSection = sectionBetween(
  "id: 'clients.create'",
  "id: 'clients.delete'"
);
const deleteDuplicateSection = sectionBetween(
  "id: 'clients.delete'",
  "id: 'clients.add_tag'"
);
const ticketInteractionSection = sectionBetween(
  "id: 'clients.assign_to_ticket'",
  '});\n}'
);

describe('client workflow business operations tenant-scoped query contract', () => {
  it('uses the structural tenant-scoped query helper for client workflow roots', () => {
    expect(source).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(tx: TenantTxContext, table: string)');
    expect(source).toContain('function tenantScopedTableForTenant(trx: Knex.Transaction, tenant: string, table: string)');
    expect(source).toContain('tenantDb(tx.trx, tx.tenantId).table(table)');
    expect(source).toContain('tenantDb(trx, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\.where\(\{[^}]*['"]?[^'"}]*tenant[^'"}]*['"]?\s*:/s);
  });

  it('uses structural tenant scoping for shared helper and cleanup roots', () => {
    expect(helperSection).toContain("tenantScopedTable(tx, 'clients')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'tickets')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'contacts')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'users')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'client_locations')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'tag_definitions')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'tag_mappings')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenant, 'contracts')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenant, 'client_contracts')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenant, 'invoice_charges')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenant, 'clients')");
    expect(helperSection).toContain("deleteFromTenantTableIfExists(trx, tenant, 'documents'");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'entra_client_tenant_mappings')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'statuses')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'default_billing_settings')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'document_block_content')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'documents')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'document_types')");
    expect(helperSection).not.toContain("tx.trx('clients').where");
    expect(helperSection).not.toContain("tx.trx('tickets').where");
    expect(helperSection).not.toContain("tx.trx('contacts').where");
    expect(helperSection).not.toContain("tx.trx('client_locations').where");
    expect(helperSection).not.toContain("trx('contracts').where");
    expect(helperSection).not.toContain("trx('client_contracts').where");
  });

  it('uses structural tenant scoping for find/search roots', () => {
    expect(findSearchSection).toContain("tenantScopedTable(tx, 'clients')");
    expect(findSearchSection).toContain("tenantScopedTable(tx, 'contacts')");
    expect(findSearchSection).not.toContain("tx.trx('clients').where");
    expect(findSearchSection).not.toContain("tx.trx('contacts').where");
    expect(findSearchSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for create/update/archive roots', () => {
    expect(createUpdateArchiveSection).toContain("tenantScopedTable(tx, 'clients')");
    expect(createUpdateArchiveSection).not.toContain("tx.trx('clients').where");
    expect(createUpdateArchiveSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for delete/duplicate roots', () => {
    expect(deleteDuplicateSection).toContain("tenantScopedTable(tx, 'clients')");
    expect(deleteDuplicateSection).toContain("tenantScopedTable(tx, 'tenant_companies')");
    expect(deleteDuplicateSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'clients')");
    expect(deleteDuplicateSection).toContain("tenantScopedTable(tx, 'tag_mappings as tm')");
    expect(deleteDuplicateSection).toContain("tenantScopedTable(tx, 'client_locations')");
    expect(deleteDuplicateSection).not.toContain("tx.trx('clients').where");
    expect(deleteDuplicateSection).not.toContain("tx.trx('tag_mappings as tm')");
    expect(deleteDuplicateSection).not.toContain("'tm.tenant': tx.tenantId");
    expect(deleteDuplicateSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for ticket assignment and interaction roots', () => {
    expect(ticketInteractionSection).toContain("tenantScopedTable(tx, 'contacts')");
    expect(ticketInteractionSection).toContain("tenantScopedTable(tx, 'client_locations')");
    expect(ticketInteractionSection).toContain("tenantScopedTable(tx, 'tickets')");
    expect(ticketInteractionSection).not.toContain("tx.trx('contacts').where");
    expect(ticketInteractionSection).not.toContain("tx.trx('client_locations').where");
    expect(ticketInteractionSection).not.toContain("tx.trx('tickets').where");
    expect(ticketInteractionSection).not.toContain(".where({ tenant: tx.tenantId");
  });
});
