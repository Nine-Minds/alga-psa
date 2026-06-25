import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TeamService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetweenAfter(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('team service helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for hierarchy helper and capacity roots', () => {
    const section = sectionBetweenAfter('* Check if creating hierarchy would cause circular dependency', '// Team Member Management');

    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain("table: 'team_hierarchy'");
    expect(section).toContain("table: 'project_team_assignments'");

    expect(section).not.toMatch(/trx\('team_hierarchy'\)\s*\.(?:where|pluck)/);
    expect(section).not.toMatch(/knex\('project_team_assignments'\)\s*\./);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
  });
});
