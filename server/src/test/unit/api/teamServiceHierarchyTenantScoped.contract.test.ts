import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TeamService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('team service hierarchy tenant-scoped query contract', () => {
  it('uses structural tenant scoping for hierarchy roots', () => {
    const section = sectionBetween('// Team Hierarchy and Reporting', '// Team Permissions and Access Control');

    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('teams as t')");
    expect(section).toContain(".table('teams')");
    expect(section).toContain(".table('team_hierarchy')");

    expect(section).not.toMatch(/knex\('(?:teams as t|team_hierarchy)'\)\s*\./);
    expect(section).not.toMatch(/trx\('teams'\)\s*\.(?:where|first)/);
    expect(section).not.toMatch(/\.where\('t\.tenant', context\.tenant\)/);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
  });
});
