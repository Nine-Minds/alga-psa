import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'roleActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('role actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for role/user reads and user-role deletes', () => {
    expect(source).toContain('tenantDb(trx, ');
    expect(source).toContain(".table('roles");
    expect(source).toContain(".table('users");
    // user_roles is written through @alga-psa/db, which carries the contact's
    // portal-admin flag sync and keeps its own tenant-scoping contract
    // (userRoleWritesTenantScoped.contract.test.ts); alga-2026-0003347.
    expect(source).toContain('const [userRole] = await addUserRoles(trx, tenant, userId, [roleId]);');
    expect(source).toContain('await removeUserRoles(trx, tenant, userId, [roleId]);');

    expect(source).not.toMatch(/trx\('roles'\)\s*\./);
    expect(source).not.toMatch(/trx\('users'\)\s*\./);
    expect(source).not.toMatch(/trx\('user_roles'\)\s*[\r\n]+\s*\.where/);
    expect(source).not.toMatch(/\.where\(\{\s*tenant\s*\}\)/);
    expect(source).not.toMatch(/\.where\(\{\s*user_id: userId,\s*role_id: roleId,\s*tenant\s*\}\)/);
  });
});
