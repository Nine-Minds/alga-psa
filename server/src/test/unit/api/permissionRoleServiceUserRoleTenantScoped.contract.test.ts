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

describe('permission role service user-role tenant-scoped query contract', () => {
  it('uses structural tenant scoping for user-role direct roots', () => {
    const section = sectionBetween('// USER-ROLE MANAGEMENT', '// PERMISSION CHECKS');

    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('users as u')");
    expect(section).toContain(".table('roles as r')");
    expect(section).toContain(".table('users')");
    expect(section).toContain(".table('roles')");
    expect(section).toContain(".table('user_roles')");

    expect(section).not.toMatch(/knex\('(?:users as u|roles as r)'\)\s*\./);
    expect(section).not.toMatch(/trx\('(?:users|roles|user_roles)'\)\s*\.(?:where|whereIn|delete|pluck|count)/);
    expect(section).not.toMatch(/\.where\('(?:u\.|r\.)?tenant', context\.tenant\)/);
  });
});
