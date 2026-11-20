import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'registrationHelpers.ts'), 'utf8');

describe('registrationHelpers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known role roots', () => {
    expect(source).toContain("tenantDb(trx, contact.tenant).table<RegistrationRoleRow>('roles')");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain("trx('roles').where({ tenant: contact.tenant })");
    // user_roles is written through @alga-psa/db, which re-derives the linked
    // contact's portal-admin flag from the role the account is registered with
    // (alga-2026-0003347) and keeps its own tenant-scoping contract.
    expect(source).toContain("await addUserRoles(trx, contact.tenant, user.user_id, [userRole.role_id]);");
  });
});
