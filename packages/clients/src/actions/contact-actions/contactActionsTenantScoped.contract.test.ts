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

    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).not.toContain('createTenantScopedQuery');

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

  it('uses structural tenant scoping for invitation and contact update roots', () => {
    const invitationSection = sectionBetween('export const getContactsEligibleForInvitation', 'export const addContact');
    const phoneTypeSection = sectionBetween('export const listContactPhoneTypeSuggestions', 'export const getCustomPhoneTypeUsageCount');
    const updateSection = sectionBetween('export const updateContact', 'export const updateContactsForClient');
    const updateClientContactsSection = sectionBetween('export const updateContactsForClient', 'export async function exportContactsToCSV');

    expect(invitationSection).toContain("tenantScopedTable(trx, 'contacts as c', tenant)");
    expect(invitationSection).not.toContain("trx('contacts as c')");
    expect(invitationSection).not.toContain(".where('c.tenant', tenant)");

    expect(phoneTypeSection).toContain("tenantScopedTable(trx, 'contact_phone_type_definitions', tenant)");
    expect(phoneTypeSection).not.toContain("trx('contact_phone_type_definitions')");
    expect(phoneTypeSection).not.toContain('.where({ tenant })');

    expect(updateSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(updateSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(updateSection).toContain("tenantScopedTable(trx, 'inbound_ticket_defaults', tenant)");
    expect(updateSection).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(updateSection).not.toContain("trx('contacts')");
    expect(updateSection).not.toContain("trx('clients')");
    expect(updateSection).not.toContain("trx('inbound_ticket_defaults')");
    expect(updateSection).not.toContain("trx('users')");
    expect(updateSection).not.toContain(".where({ email: contactData.email!.trim().toLowerCase(), tenant })");
    expect(updateSection).not.toContain('tenant, user_type');

    expect(updateClientContactsSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(updateClientContactsSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(updateClientContactsSection).not.toContain(".where({ client_id: clientId, tenant })");
    expect(updateClientContactsSection).not.toContain("trx('clients')");
    expect(updateClientContactsSection).not.toContain("trx('contacts')");
  });

  it('uses structural tenant scoping for CSV import duplicate and email checks', () => {
    const importHelperSection = sectionBetween('async function findExistingContactByImportedEmails', 'function toContactEmailAddressInput');
    const importSection = sectionBetween('export const importContactsFromCSV', 'export const checkExistingEmails');
    const checkEmailsSection = sectionBetween('export const checkExistingEmails', 'export const getContactByEmail');

    expect(importHelperSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(importHelperSection).toContain("tenantScopedTable(trx, 'contact_additional_email_addresses', tenant)");
    expect(importHelperSection).not.toContain("trx('contacts')");
    expect(importHelperSection).not.toContain("trx('contact_additional_email_addresses')");
    expect(importHelperSection).not.toContain(".andWhere('tenant', tenant)");

    expect(importSection).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(importSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(importSection).toContain("tenantScopedTable(trx, 'tag_mappings', tenant)");
    expect(importSection).not.toContain("trx('clients')");
    expect(importSection).not.toContain("trx('contacts')");
    expect(importSection).not.toContain("trx('tag_mappings')");
    expect(importSection).not.toContain('tenant,\n                client_id');
    expect(importSection).not.toContain("tagged_type: 'contact', tenant");

    expect(checkEmailsSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(checkEmailsSection).toContain("tenantScopedTable(trx, 'contact_additional_email_addresses', tenant)");
    expect(checkEmailsSection).not.toContain(".andWhere('tenant', tenant)");
    expect(checkEmailsSection).not.toContain("trx('contacts')");
    expect(checkEmailsSection).not.toContain("trx('contact_additional_email_addresses')");
  });

  it('uses structural tenant scoping for contact helper and visibility-group roots', () => {
    const contactLookupSection = sectionBetween('export const getContactByEmail', 'export const updateContactPortalAdminStatus');
    const portalUserSection = sectionBetween('export const updateContactPortalAdminStatus', 'type VisibilityGroupListItem');
    const visibilitySection = source.slice(source.indexOf('type VisibilityGroupListItem'));

    expect(contactLookupSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(contactLookupSection).not.toContain(".where({ email: email.toLowerCase(), client_id: clientId, tenant })");
    expect(contactLookupSection).not.toContain(".where({ email: email.trim().toLowerCase(), tenant })");

    expect(portalUserSection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(portalUserSection).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(portalUserSection).toContain("tenantScopedTable(trx, 'user_roles', tenant)");
    expect(portalUserSection).not.toContain(".where({ contact_name_id: contactId, tenant })");
    expect(portalUserSection).not.toContain('tenant: tenant, user_type');
    expect(portalUserSection).not.toContain("'user_roles.tenant': tenant");

    expect(visibilitySection).toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(visibilitySection).toContain("tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)");
    expect(visibilitySection).toContain("tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)");
    expect(visibilitySection).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(visibilitySection).not.toContain('.where({ tenant, contact_name_id: contactId })');
    expect(visibilitySection).not.toContain('.where({ tenant, client_id: clientId, group_id: groupId })');
    expect(visibilitySection).not.toContain('.where({ tenant, group_id: groupId })');
    expect(visibilitySection).not.toContain('.where({ tenant })');
    expect(visibilitySection).not.toContain('tenant, client_id: clientId, portal_visibility_group_id: groupId');
  });
});
