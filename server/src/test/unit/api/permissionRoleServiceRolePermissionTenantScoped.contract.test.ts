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

describe('permission role service role-permission tenant-scoped query contract', () => {
  it('uses structural tenant scoping for role-permission roots', () => {
    const section = sectionBetween('// ROLE-PERMISSION MANAGEMENT', '// USER-ROLE MANAGEMENT');

    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('permissions as p')");
    expect(section).toContain(".table('roles')");
    expect(section).toContain(".table('permissions')");
    expect(section).toContain(".table('role_permissions')");

    expect(section).not.toMatch(/knex\('permissions as p'\)\s*\./);
    expect(section).not.toMatch(/transaction\('(?:roles|permissions|role_permissions)'\)\s*\.(?:where|whereIn|delete|pluck)/);
    expect(section).not.toMatch(/trx\('(?:roles|role_permissions)'\)\s*\.(?:where|delete)/);
    expect(section).not.toMatch(/\.where\('(?:p\.)?tenant', context\.tenant\)/);
  });
});
