import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const searchSection = source.slice(
  source.indexOf('export const searchDocumentAssociationEntities = withAuth(async ('),
  source.indexOf('// Create document associations')
);

describe('document association entity search tenant-scoped query contract', () => {
  it('uses structural tenant scoping for each searchable entity root', () => {
    expect(searchSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(searchSection).toContain("tenantScopedTable(trx, 'contacts as c', tenant)");
    expect(searchSection).toContain("tenantScopedTable(trx, 'tickets as t', tenant)");
    expect(searchSection).toContain("tenantScopedTable(trx, 'assets as a', tenant)");
    expect(searchSection).toContain("tenantScopedTable(trx, 'project_tasks as pt', tenant)");
    expect(searchSection).toContain("tenantScopedTable(trx, 'contracts as c', tenant)");
    expect(searchSection).toContain("tenantScopedTable(trx, 'quotes as q', tenant)");
    expect(searchSection).not.toContain("trx('clients')");
    expect(searchSection).not.toContain("trx('contacts as c')");
    expect(searchSection).not.toContain("trx('tickets as t')");
    expect(searchSection).not.toContain("trx('assets as a')");
    expect(searchSection).not.toContain("trx('project_tasks as pt')");
    expect(searchSection).not.toContain("trx('contracts as c')");
    expect(searchSection).not.toContain("trx('quotes as q')");
    expect(searchSection).not.toContain('.where({ tenant })');
    expect(searchSection).not.toContain(".where('c.tenant', tenant)");
    expect(searchSection).not.toContain(".where('t.tenant', tenant)");
    expect(searchSection).not.toContain(".where('a.tenant', tenant)");
    expect(searchSection).not.toContain(".where('pt.tenant', tenant)");
    expect(searchSection).not.toContain(".where('q.tenant', tenant)");
  });
});
