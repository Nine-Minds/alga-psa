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

describe('permission role service analytics tenant-scoped query contract', () => {
  it('uses structural tenant scoping for analytics and audit roots', () => {
    const section = sectionBetween('// ANALYTICS AND AUDITING', '// BULK OPERATIONS');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('roles as r')");
    expect(section).toContain(".table('roles')");
    expect(section).toContain(".table('permissions')");
    expect(section).toContain(".table('permissions as p')");
    expect(section).toContain(".table('user_roles')");
    expect(section).toContain(".table('user_roles as ur')");
    expect(section).toContain(".table('audit_logs')");

    expect(section).not.toMatch(/knex\('(?:roles|permissions|user_roles|audit_logs)(?: as [a-z]+)?'\)\s*\./);
    expect(section).not.toMatch(/\.where\('(?:r\.|p\.|ur\.)?tenant', context\.tenant\)/);
  });
});
