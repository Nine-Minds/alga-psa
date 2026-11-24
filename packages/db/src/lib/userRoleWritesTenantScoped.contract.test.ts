import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'userRoleWrites.ts'), 'utf8');

/**
 * This module is now the only place `user_roles` is written from, so the tenant
 * scoping the individual writers used to pin in their own contract tests lives
 * here (Citus, no RLS: tenant has to be in every predicate).
 */
describe('user role writes tenant-scoped query contract', () => {
  it('writes user_roles through the tenant facade only', () => {
    expect(source).toContain('tenantDb(trx, tenant)');
    expect(source).toContain(".table('user_roles')");
    expect(source).toContain("table<UserRoleWriteRow>('user_roles')");

    // No raw connection access, and no hand-rolled tenant predicates.
    expect(source).not.toMatch(/trx\('(users|user_roles|roles|contacts)'\)/);
    expect(source).not.toMatch(/\.where\(\{[^}]*\btenant\b[^}]*\}\)/);
    expect(source).not.toMatch(/\.where\('tenant'/);
  });

  it('carries the portal admin flag sync inside every write', () => {
    for (const writer of ['setUserRoles', 'addUserRoles', 'removeUserRoles']) {
      const start = source.indexOf(`export async function ${writer}`);
      expect(start).toBeGreaterThan(0);
      const body = source.slice(start, source.indexOf('\n}', start));
      expect(body).toContain('await syncContactClientAdminFlag(trx, tenant, userId)');
      expect(body).toContain(`assertTransaction(trx, '${writer}')`);
      expect(body.indexOf('await lockClientPortalMutations(trx, tenant)')).toBeGreaterThan(0);
      expect(body.indexOf('await lockClientPortalMutations(trx, tenant)')).toBeLessThan(body.indexOf("table('user_roles')"));
    }
  });

  it('leaves the floors, the seat guard and audit logging to the callers', () => {
    expect(source).not.toContain('assertUserRoleFloor');
    expect(source).not.toContain('assertSeatTechnicianWrite');
  });
});
