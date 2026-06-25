import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

const source = readFileSync(path.resolve(__dirname, 'contactActions.tsx'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('contactActions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for contact deletion roots', () => {
    const cleanupSection = sectionBetween('async function cleanupEntraReferencesBeforeContactDelete', 'export const getContactByContactNameId');
    const deleteSection = sectionBetween('export const deleteContact', 'type ContactFilterStatus');

    expect(source).toContain("import { createTenantKnex, createTenantScopedQuery, withTransaction } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');

    expect(cleanupSection).toContain("tenantScopedTable(trx, 'entra_contact_reconciliation_queue', tenantId)");
    expect(cleanupSection).not.toContain(".where({ tenant: tenantId, resolved_contact_id: contactId })");

    expect(deleteSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'contact_phone_numbers', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'contact_additional_email_addresses', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'comments', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'portal_invitations', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'rmm_organization_mappings', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'contacts', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'document_block_content', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'document_associations', tenantId)");
    expect(deleteSection).toContain("tenantScopedTable(trx, 'documents', tenantId)");
    expect(deleteSection).not.toContain(".where({ contact_name_id: contactId, tenant })");
    expect(deleteSection).not.toContain('tenant: tenantId');
    expect(deleteSection).not.toContain("trx('contact_phone_numbers')");
    expect(deleteSection).not.toContain("trx('document_block_content')");
  });
});
