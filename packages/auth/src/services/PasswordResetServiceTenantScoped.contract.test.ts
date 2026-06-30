import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'PasswordResetService.ts'), 'utf8');

describe('PasswordResetService tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known password reset roots', () => {
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(trx, 'password_reset_tokens', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'password_reset_tokens', tokenTenant)");
    expect(source).toContain('tokenTenantDb.tenantJoin(');
    expect(source).toContain("tenantScopedTable(trx, 'password_reset_tokens', tokenInfo.tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'password_reset_tokens', tenant)");
    expect(source).toContain("tenantScopedTable(tx, 'password_reset_tokens', resolvedTenant)");
    expect(source).toContain(".unscoped('password_reset_tokens', 'tenant discovery from password reset token')");
    expect(source).not.toContain(".where('tenant', tenant)");
    expect(source).not.toContain(".where('tenant', tokenTenant)");
    expect(source).not.toContain(".where('prt.tenant', tokenTenant)");
    expect(source).not.toContain('tenant: tokenInfo.tenant');
  });
});
