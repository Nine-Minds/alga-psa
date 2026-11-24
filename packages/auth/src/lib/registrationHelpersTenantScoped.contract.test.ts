import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'registrationHelpers.ts'), 'utf8');

describe('registrationHelpers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known role roots', () => {
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain("trx('roles').where({ tenant: contact.tenant })");
    // The role of a new portal account is resolved from the contact's
    // portal-admin pre-mark, and user_roles is written, through @alga-psa/db:
    // both keep their own tenant-scoping contract and re-derive the flag from
    // the role that was actually written (alga-2026-0003347).
    expect(source).toContain('await resolveInitialPortalRoleId(trx, contact.tenant, contact.contact_name_id);');
    expect(source).toContain('await addUserRoles(trx, contact.tenant, user.user_id, [roleId]);');
  });
});
