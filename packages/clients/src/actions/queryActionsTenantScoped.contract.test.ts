import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

const source = readFileSync(path.resolve(__dirname, 'queryActions.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('queryActions tenant-scoped query contract', () => {
  it('uses tenantDb roots for client portal helper and client query roots', () => {
    const portalHelperSection = sectionBetween('async function getClientPortalUserClientIdForAction', 'async function hasClientPortalOwnClientPermissionForAction');
    const getClientByIdSection = sectionBetween('export const getClientById', 'export const getAllClients');
    const getAllClientsSection = sectionBetween('export const getAllClients', '// --- Contact query actions ---');

    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable<');

    expect(portalHelperSection).toContain("tenantScopedTable(db, 'contacts', tenant)");
    expect(portalHelperSection).not.toContain("db('contacts')");
    expect(portalHelperSection).not.toContain('tenant\n    })');

    expect(getClientByIdSection).toContain('const db = tenantDb(trx, tenant);');
    expect(getClientByIdSection).toContain("const query = db.table<any>('clients as c');");
    expect(getClientByIdSection).toContain("db.tenantJoin(query, 'users as u'");
    expect(getClientByIdSection).toContain("db.tenantJoin(query, 'client_locations as cl'");
    expect(getClientByIdSection).not.toContain("trx('clients as c')");
    expect(getClientByIdSection).not.toContain("'c.tenant': tenant");
    expect(getClientByIdSection).not.toContain(".andOn('c.tenant'");

    expect(getAllClientsSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(getAllClientsSection).not.toContain("trx('clients')");
    expect(getAllClientsSection).not.toContain(".where('tenant', tenant)");
  });

  it('uses tenantDb roots and joins for contact list lookups', () => {
    const contactsByClientSection = sectionBetween('export const getContactsByClient', 'function buildContactListSearchPrefixTsquery');
    const getAllContactsSection = sectionBetween('export const getAllContacts', 'export const findContactByEmailAddress');
    const createOrFindSection = sectionBetween('export const createOrFindContactByEmail', 'function extractNameFromEmail');

    expect(contactsByClientSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(contactsByClientSection).toContain("const facade = tenantDb(trx, tenant);");
    expect(contactsByClientSection).toContain("const contactQuery = facade.table('contacts')");
    expect(contactsByClientSection).toContain("facade.tenantJoin(contactQuery, 'clients'");
    expect(contactsByClientSection).not.toContain("trx('clients')");
    expect(contactsByClientSection).not.toContain("trx('contacts')");
    expect(contactsByClientSection).not.toContain(".andWhere('contacts.tenant'");

    expect(getAllContactsSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(getAllContactsSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(getAllContactsSection).not.toContain("trx('contacts')");
    expect(getAllContactsSection).not.toContain("trx('clients')");
    expect(getAllContactsSection).not.toContain(".where('tenant', tenant)");

    expect(createOrFindSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(createOrFindSection).not.toContain("trx('clients')");
    expect(createOrFindSection).not.toContain('tenant })');
  });

  it('uses facade-derived tables for contact list indexed search joins', () => {
    const searchSection = sectionBetween('export const searchContactListIds', 'export const getAllContacts');

    expect(searchSection).toContain('const scopedDb = tenantDb(trx, tenant);');
    expect(searchSection).toContain("const searchIndex = tenantScopedDerivedTableSql(scopedDb, 'app_search_index', 'si');");
    expect(searchSection).toContain("const interactions = tenantScopedDerivedTableSql(scopedDb, 'interactions', 'interaction_match');");
    expect(searchSection).toContain("const noteContacts = tenantScopedDerivedTableSql(scopedDb, 'contacts', 'note_contact');");
    expect(searchSection).toContain("const documentAssociations = tenantScopedDerivedTableSql(scopedDb, 'document_associations', 'document_contact_match');");
    expect(searchSection).toContain('const interactionJoin = tenantJoinSubquerySql(');
    expect(searchSection).toContain('const noteContactJoin = tenantJoinSubquerySql(');
    expect(searchSection).toContain('const documentAssociationJoin = tenantJoinSubquerySql(');
    expect(searchSection).toContain("joinedTenantColumn: 'interaction_match.tenant'");
    expect(searchSection).toContain("joinedTenantColumn: 'note_contact.tenant'");
    expect(searchSection).toContain("joinedTenantColumn: 'document_contact_match.tenant'");
    expect(searchSection).not.toMatch(/interaction_match\.tenant\s*=\s*si\.tenant/);
    expect(searchSection).not.toMatch(/note_contact\.tenant\s*=\s*si\.tenant/);
    expect(searchSection).not.toMatch(/document_contact_match\.tenant\s*=\s*si\.tenant/);
    expect(searchSection).not.toContain('FROM app_search_index si');
    expect(searchSection).not.toContain('WHERE si.tenant = ?');
  });
});
