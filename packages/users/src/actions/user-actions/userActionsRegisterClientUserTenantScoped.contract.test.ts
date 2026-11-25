import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user actions register client user tenant-scoped query contract', () => {
  it('uses facade tenant joins for contact email verification discovery', () => {
    const section = sectionBetween('export async function verifyContactEmail', 'export const registerClientUser');

    expect(section).toContain(".unscoped('contacts', 'tenant discovery for client portal registration contact lookup')");
    expect(section).toContain("discoveryDb.tenantJoin(contactQuery, 'clients', 'clients.client_id', 'contacts.client_id')");
    expect(section).not.toContain(".andOn('clients.tenant', '=', 'contacts.tenant')");
  });

  it('uses structural tenant scoping for tenant-known client-role lookup', () => {
    const section = sectionBetween('export const registerClientUser', 'export const checkPasswordResetStatus');

    expect(section).toContain(".unscoped('contacts', 'tenant discovery for client portal registration contact lookup')");
    expect(section).toContain("discoveryDb.tenantJoin(contactQuery, 'clients', 'clients.client_id', 'contacts.client_id')");
    expect(section).toContain('findExistingUserByEmailGlobally(email');
    expect(section).toContain("contact_kind: 'contacts.contact_kind'");
    expect(section).toContain("contact.contact_kind === 'shared_mailbox'");
    expect(section).toContain("await tenantDb(trx, contact.tenant).table('users')");
    // Registration uses the User role, irrespective of the invitation pre-seed.
    // Shared role lookup and writes carry tenant scoping and flag synchronization.
    expect(section).toContain('await resolveInitialPortalRoleId(trx, contact.tenant, null);');
    expect(section).toContain('await addUserRoles(trx, contact.tenant, newUser.user_id, [roleId]);');
    expect(section).toContain('tenant: contact.tenant');

    expect(section).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where\(\{\s*tenant: contact\.tenant,/);
    expect(section).not.toContain(".andOn('clients.tenant', '=', 'contacts.tenant')");
  });
});
