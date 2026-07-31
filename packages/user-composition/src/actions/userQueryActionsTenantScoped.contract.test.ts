import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userQueryActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('user query actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for direct user, role, and contact roots', () => {
    expect(source).toContain('tenantDb(trx, tenant)');
    expect(source).toContain(".table('users')");
    expect(source).toContain(".table<IRole>('roles')");
    expect(source).toContain(".table('contacts')");
    expect(source).toContain("db.tenantJoin(usersQuery, 'contacts', 'users.contact_id', 'contacts.contact_name_id')");
    expect(source).not.toContain('createTenantScopedQuery');

    expect(source).not.toContain('tenant: tenant || undefined');
    expect(source).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.(?:whereIn|where|join)/);
    expect(source).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where/);
    expect(source).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.where/);
    expect(source).not.toContain("'users.tenant': tenant");
    expect(source).not.toContain(".andOn('contacts.tenant', '=', 'users.tenant')");
  });
});
