import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/PermissionRoleService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('permission role service role tenant-scoped query contract', () => {
  it('uses structural tenant scoping for role-management roots', () => {
    const section = sectionBetween('// ROLE MANAGEMENT', '// ROLE-PERMISSION MANAGEMENT');

    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain("table: 'roles as r'");
    expect(section).toContain("table: 'roles'");
    expect(section).toContain("table: 'role_permissions'");
    expect(section).toContain("table: 'role_permissions as rp'");
    expect(section).toContain("table: 'user_roles'");

    expect(section).not.toMatch(/knex\('roles(?: as r)?'\)\s*\./);
    expect(section).not.toMatch(/knex\('role_permissions(?: as rp)?'\)\s*\./);
    expect(section).not.toMatch(/trx\('roles'\)\s*\.(?:where|update|delete)/);
    expect(section).not.toMatch(/trx\('role_permissions'\)\s*\.(?:where|delete)/);
    expect(section).not.toMatch(/trx\('user_roles'\)\s*\.where/);
    expect(section).not.toMatch(/\.where\('(?:r\.|rp\.)?tenant', context\.tenant\)/);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
  });
});
