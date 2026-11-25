import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'policyActions.ts'), 'utf8');

describe('policy actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for role, permission, user, ticket, and policy roots', () => {
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(trx, 'roles', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'roles', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'role_permissions', tenant)");
    // The user_roles reads keep the structural facade; the writes moved to
    // @alga-psa/db, which carries the contact's portal-admin flag sync and has
    // its own tenant-scoping contract (alga-2026-0003347).
    expect(source).toContain("scopedDb.table('user_roles')");
    expect(source).toContain('await addUserRoles(trx, tenant, userId, [roleId]);');
    expect(source).toContain('await removeUserRoles(trx, tenant, userId, [roleId]);');
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'policies', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'permissions', tenant)");
    expect(source).not.toContain('.where({ tenant })');
    expect(source).not.toContain('tenant: tenantId');
    expect(source).not.toContain('.where({ role_id: roleId, tenant');
    expect(source).not.toContain('.where({ permission_id: permissionId, tenant');
    expect(source).not.toContain('.where({ user_id: userId, tenant');
    expect(source).not.toContain('.where({ ticket_id: ticketId, tenant');
    expect(source).not.toContain('.where({ policy_id: policyId, tenant');
    expect(source).not.toContain("'user_roles.tenant': tenant");
    expect(source).not.toContain("'role_permissions.tenant': tenant");
  });
});
