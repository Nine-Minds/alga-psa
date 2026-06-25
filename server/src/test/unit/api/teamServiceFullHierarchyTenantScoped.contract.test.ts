import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TeamService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('team service full hierarchy tenant-scoped query contract', () => {
  it('uses structural tenant scoping for getFullHierarchy roots', () => {
    const section = sectionFrom('async getFullHierarchy');

    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain("table: 'team_hierarchy as th'");
    expect(section).toContain("table: 'team_hierarchy'");
    expect(section).toContain(".andOn('th.tenant', '=', 't.tenant')");

    expect(section).not.toMatch(/knex\('team_hierarchy(?: as th)?'\)\s*\./);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
  });
});
