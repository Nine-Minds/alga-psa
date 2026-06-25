// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readPermissionManagementSection(): string {
  const source = fs.readFileSync(
    path.join(repoRoot, 'server/src/lib/api/services/PermissionRoleService.ts'),
    'utf8'
  );
  const start = source.indexOf('// PERMISSION MANAGEMENT');
  const end = source.indexOf('// ROLE MANAGEMENT');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('permission role service permission tenant-scoped query contract', () => {
  it('uses structural tenant scoping for permission-management roots', () => {
    const section = readPermissionManagementSection();

    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain("table: 'permissions'");
    expect(section).toContain("table: 'permissions as p'");
    expect(section).toContain("table: 'role_permissions'");
    expect(section).not.toMatch(/knex\('permissions(?: as p)?'\)\s*\.(?:where|leftJoin)/);
    expect(section).not.toMatch(/trx\('permissions'\)\s*\.where/);
    expect(section).not.toMatch(/trx\('role_permissions'\)\s*\.where/);
    expect(section).not.toMatch(/\.where\('(?:p\.)?tenant', context\.tenant\)/);
  });
});
