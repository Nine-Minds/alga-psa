import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const crmSource = fs.readFileSync(path.resolve(__dirname, '../businessOperations/crm.ts'), 'utf8');
const contactsSource = fs.readFileSync(path.resolve(__dirname, '../businessOperations/contacts.ts'), 'utf8');

function sectionBetween(start: string, end: string): string {
  const startIndex = crmSource.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : crmSource.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Unable to locate CRM workflow action section: ${start} -> ${end}`);
  }
  return crmSource.slice(startIndex, endIndex);
}

function sectionFrom(start: string): string {
  const startIndex = crmSource.indexOf(start);
  if (startIndex === -1) {
    throw new Error(`Unable to locate CRM workflow action section: ${start}`);
  }
  return crmSource.slice(startIndex);
}

const helperSection = sectionBetween(
  'async function validateInteractionTypeId',
  'export function registerCrmActions'
);
const actionSection = sectionFrom('export function registerCrmActions');

describe('CRM workflow action tenant-scoped query contract', () => {
  it('uses structural tenant scoping for CRM action helper roots', () => {
    expect(crmSource).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(crmSource).toContain('function tenantScopedTable(tx: TenantTxContext, table: string): Knex.QueryBuilder');
    expect(crmSource).toContain(
      'function tenantScopedTableForTenant(trx: Knex.Transaction, tenantId: string, table: string): Knex.QueryBuilder'
    );
    expect(crmSource).toContain('tenantDb(tx.trx, tx.tenantId).table(table)');
    expect(crmSource).toContain('tenantDb(trx, tenantId).table(table)');
    expect(crmSource).not.toContain('createTenantScopedQuery');

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

  it('routes CRM action tenant roots through tenantDb', () => {
    const directRootPattern =
      /\btx\.trx\s*(?:<[^>]+>)?\s*\(\s*['`](?:clients|contacts|interactions|interaction_types|projects|quotes|statuses|tag_mappings|tickets|users)['`]/;

    expect(actionSection).toContain("tenantScopedTable(tx, 'interaction_types')");
    expect(actionSection).toContain("tenantScopedTable(tx, 'interactions')");
    expect(actionSection).toContain("tenantScopedTable(tx, 'quotes')");
    expect(actionSection).toContain("tenantScopedTable(tx, 'tag_mappings')");
    expect(actionSection).toContain("db.tenantJoin(query, 'clients as c'");
    expect(actionSection).toContain("db.tenantJoin(query, 'interaction_types as it'");
    expect(actionSection).not.toMatch(directRootPattern);
    expect(actionSection).not.toMatch(/\.where\(\{\s*tenant\s*:/);
    expect(actionSection).not.toMatch(/\.(?:where|andWhere)\(\s*['`][^'`]*tenant['`]/);

    expect(actionSection).toContain("tenantScopedTable(tx, 'system_interaction_types')");
    expect(actionSection).not.toContain("tx.trx('system_interaction_types')");
  });

  it('routes contact action tenant roots through tenantDb', () => {
    const directRootPattern =
      /\b(?:tx\.trx|trx)\s*(?:<[^>]+>)?\s*\(\s*['`](?:clients|comments|contact_additional_email_addresses|contact_phone_numbers|contacts|document_associations|document_block_content|document_types|documents|entra_contact_reconciliation_queue|interactions|portal_invitations|statuses|tag_definitions|tag_mappings|tickets)['`]/;

    expect(contactsSource).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(contactsSource).toContain("tenantDb(tx.trx, tx.tenantId).table(table)");
    expect(contactsSource).toContain("tenantDb(trx, tenantId).table(table)");
    expect(contactsSource).toContain("db.subquery('contact_additional_email_addresses as caea')");
    expect(contactsSource).toContain("db.tenantJoin(base, 'tag_mappings as tm'");
    expect(contactsSource).toContain("db.tenantJoin(sourceTagsQuery, 'tag_definitions as td'");
    expect(contactsSource).not.toMatch(directRootPattern);
    expect(contactsSource).not.toMatch(/\.where\(\{\s*tenant\s*:/);
    expect(contactsSource).not.toMatch(/\.(?:where|andWhere)\(\s*['`][^'`]*tenant['`]/);
    expect(contactsSource).not.toContain(".from('contact_additional_email_addresses as caea')");
  });
});
