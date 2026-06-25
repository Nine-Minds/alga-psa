import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/PermissionRoleService.ts');
const source = readFileSync(servicePath, 'utf8');

function methodSection(methodName: string): string {
  const start = source.indexOf(`async ${methodName}`);
  const end = source.indexOf('\n}', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('permission role service roles-by-permission tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the roles-by-permission root', () => {
    const section = methodSection('getRolesByPermission');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('roles as r')");
    expect(section).not.toMatch(/knex\('roles as r'\)\s*\./);
    expect(section).not.toMatch(/\.where\('r\.tenant', context\.tenant\)/);
  });
});
