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

describe('team service analytics tenant-scoped query contract', () => {
  it('uses structural tenant scoping for team analytics roots', () => {
    const section = sectionBetween('// Team Analytics and Performance', '// Search and Filtering');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('teams')");
    expect(section).toContain(".table('team_members as tm')");
    expect(section).toContain(".table('project_team_assignments as pta')");
    expect(section).toContain(".table('time_entries as te')");

    expect(section).not.toMatch(/knex\('(?:teams|team_members as tm|project_team_assignments as pta|time_entries as te)'\)\s*\./);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
    expect(section).not.toMatch(/\.where\('(?:tm\.|pta\.)?tenant', context\.tenant\)/);
  });
});
