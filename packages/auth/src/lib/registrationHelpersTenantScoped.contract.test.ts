import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'registrationHelpers.ts'), 'utf8');

describe('registrationHelpers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known role roots', () => {
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain("trx('roles').where({ tenant: contact.tenant })");
    // Registration uses the User role, irrespective of the invitation pre-seed.
    // Shared role lookup and writes carry tenant scoping and flag synchronization.
    expect(source).toContain('await resolveInitialPortalRoleId(trx, contact.tenant, null);');
    expect(source).toContain('await addUserRoles(trx, contact.tenant, user.user_id, [roleId]);');
  });
});
