import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'registrationHelpers.ts'), 'utf8');

describe('registrationHelpers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known role roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("table: 'roles'");
    expect(source).toContain('tenant: contact.tenant');
    expect(source).not.toContain("trx('roles').where({ tenant: contact.tenant })");
  });
});
