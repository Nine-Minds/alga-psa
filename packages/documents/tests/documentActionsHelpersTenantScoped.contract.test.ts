import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const helperSection = source.slice(
  source.indexOf('export const getDocumentAssociationClientsForPicker'),
  source.indexOf('export async function authorizeAndRedactDocuments')
);

describe('document action helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for picker and authorization helper roots', () => {
    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(helperSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'contacts as c', tenant)");
    expect(helperSection).toContain("tenantScopedTable(knex, 'document_folders', tenant)");
    expect(helperSection).toContain("tenantScopedTable(knex, 'document_default_folders', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'user_roles', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'document_associations', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'project_tasks as pt', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'client_contracts', tenant)");
    expect(helperSection).not.toContain(".where('tenant', tenant)");
    expect(helperSection).not.toContain(".where('c.tenant', tenant)");
    expect(helperSection).not.toContain(".where('pt.tenant', tenant)");
    expect(helperSection).not.toContain('.where({ tenant');
  });
});
