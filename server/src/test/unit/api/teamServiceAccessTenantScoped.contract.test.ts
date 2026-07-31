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

describe('team service permissions/access tenant-scoped query contract', () => {
  it('uses structural tenant scoping for permissions and project assignment roots', () => {
    const section = sectionBetween('// Team Permissions and Access Control', '// Team Analytics and Performance');

    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('teams')");
    expect(section).toContain(".table('projects')");
    expect(section).toContain(".table('team_permissions')");
    expect(section).toContain(".table('project_team_assignments as pta')");

    expect(section).not.toMatch(/knex\('(?:team_permissions|project_team_assignments as pta)'\)\s*\./);
    expect(section).not.toMatch(/trx\('(?:teams|projects)'\)\s*\.(?:where|first)/);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
  });
});
