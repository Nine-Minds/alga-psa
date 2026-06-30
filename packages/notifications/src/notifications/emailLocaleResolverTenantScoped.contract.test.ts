import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'emailLocaleResolver.ts'), 'utf8');

describe('email locale resolver tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known locale lookup roots', () => {
    expect(source).toContain('function tenantScopedTable');
    expect(source).toContain('tenantDb(knex, tenantId).table(table)');
    expect(source).toContain("tenantScopedTable(knex, 'users', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'contacts', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'user_preferences', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'clients', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'tenant_settings', tenantId)");

    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\bknex\('(users|contacts|user_preferences|clients|tenant_settings)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/\bknex\('(users|contacts|user_preferences|clients|tenant_settings)'\)\.where\(\{[^}]*tenant/);
  });
});
