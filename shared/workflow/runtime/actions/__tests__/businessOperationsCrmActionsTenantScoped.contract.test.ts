import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../businessOperations/crm.ts'), 'utf8');

function sectionBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Unable to locate CRM workflow action section: ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

const helperSection = sectionBetween(
  'async function validateInteractionTypeId',
  'export function registerCrmActions'
);

describe('CRM workflow action tenant-scoped query contract', () => {
  it('uses structural tenant scoping for CRM action helper roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(tx: TenantTxContext, table: string): Knex.QueryBuilder');
    expect(source).toContain(
      'function tenantScopedTableForTenant(trx: Knex.Transaction, tenantId: string, table: string): Knex.QueryBuilder'
    );

    expect(helperSection).toContain("tenantScopedTable(tx, 'interaction_types')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'statuses')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'interactions as i')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'contacts')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'clients')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'user_roles')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'team_members')");
    expect(helperSection).toContain("tenantScopedTableForTenant(trx, tenantId, 'users')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'contacts')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'quotes')");

    expect(helperSection).not.toMatch(/\.where\(\{[^}]*['"]?[^'"}]*tenant[^'"}]*['"]?\s*:/s);
    expect(helperSection).not.toMatch(/\.where\(['"][^'"]*tenant['"]/);
    expect(helperSection).not.toContain("tx.trx('interaction_types').where");
    expect(helperSection).not.toContain("tx.trx('statuses').where");
    expect(helperSection).not.toContain("tx.trx('contacts').where");
    expect(helperSection).not.toContain("tx.trx('quotes').where");
  });
});
