import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'registrationActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('registration actions tenant-scoped query contract', () => {
  it('uses facade tenant joins for contact-based tenant discovery', () => {
    expect(source).toContain("discoveryDb.tenantJoin(contactQuery, 'clients', 'contacts.client_id', 'clients.client_id')");
    expect(source).not.toContain(".andOn('contacts.tenant', '=', 'clients.tenant')");
  });

  it('uses structural tenant scoping after contact tenant resolution', () => {
    const section = sectionFrom('async function registerContactUser');

    expect(section).toContain('tenantDb(trx, ');
    expect(section).toContain("discoveryDb.tenantJoin(contactQuery, 'clients', 'contacts.client_id', 'clients.client_id')");
    expect(section).toContain(".table('users");
    expect(section).toContain('tenant: contact.tenant');
    expect(section).toContain("contact_kind: 'contacts.contact_kind'");
    expect(section).toContain("contact.contact_kind === 'shared_mailbox'");
    expect(section).toContain("const [user] = await tenantDb(trx, contact.tenant).table('users')");
    // The initial portal role is resolved from the contact's portal-admin
    // pre-mark, and user_roles is written, through @alga-psa/db: both carry the
    // contact's flag sync and keep their own tenant-scoping contract
    // (userRoleWritesTenantScoped.contract.test.ts); alga-2026-0003347.
    expect(section).toContain('await resolveInitialPortalRoleId(trx, contact.tenant, contact.contact_name_id);');
    expect(section).toContain('await addUserRoles(trx, contact.tenant, user.user_id, [roleId]);');

    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/trx\('roles'\)\.where\(\{\s*tenant: contact\.tenant\s*\}\)/);
  });
});
