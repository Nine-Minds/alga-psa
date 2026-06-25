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

describe('permission role service feature-access tenant-scoped query contract', () => {
  it('uses structural tenant scoping for feature access lookup roots', () => {
    const section = sectionBetween('// FEATURE TOGGLES', '// HELPER METHODS');

    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain("table: 'feature_toggles'");
    expect(section).toContain("table: 'users'");
    expect(section).not.toMatch(/knex\('(?:feature_toggles|users)'\)\s*\./);
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });
});
