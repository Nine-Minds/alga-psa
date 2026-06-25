import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'registrationHelpers.ts'), 'utf8');

describe('registrationHelpers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known role roots', () => {
    expect(source).toContain("tenantDb(trx, contact.tenant).table<RegistrationRoleRow>('roles')");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain("trx('roles').where({ tenant: contact.tenant })");
  });
});
