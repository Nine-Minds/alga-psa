import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'userRoleFloor.ts'), 'utf8');

describe('user role floor tenant-scoped query contract', () => {
  it('reads users, user_roles and roles through the tenant facade only', () => {
    expect(source).toContain('tenantDb(trx, tenant)');
    expect(source).toContain(".table('users')");
    expect(source).toContain(".table('user_roles')");
    expect(source).toContain(".table('roles')");
    expect(source).toContain("scopedDb.tenantJoin(query, 'users', 'user_roles.user_id', 'users.user_id')");

    // No raw connection access, and no hand-rolled tenant predicates.
    expect(source).not.toMatch(/trx\('(users|user_roles|roles)'\)/);
    expect(source).not.toMatch(/\.where\(\{[^}]*\btenant\b/);
    expect(source).not.toMatch(/\.where\('tenant'/);
  });

  it('takes the per-tenant advisory lock before any read, and only reads', () => {
    const body = source.slice(source.indexOf('export async function assertUserRoleFloor'));
    const lock = body.indexOf('await lockUserRoleFloor(trx, tenant)');
    const firstRead = body.indexOf('tenantDb(trx, tenant)');

    expect(lock).toBeGreaterThan(0);
    expect(firstRead).toBeGreaterThan(lock);
    // Citus forbids column references in UPDATE on distributed tables; this
    // module must never write at all.
    expect(source).not.toMatch(/\.(update|insert|del|delete)\(/);
  });
});
