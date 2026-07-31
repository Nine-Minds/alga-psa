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

describe('team service member-management tenant-scoped query contract', () => {
  it('uses structural tenant scoping for member-management roots', () => {
    const section = sectionBetween('// Team Member Management', '// Team Hierarchy and Reporting');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('teams')");
    expect(section).toContain(".table('users')");
    expect(section).toContain(".table('team_members')");
    expect(section).toContain(".table('task_assignments')");

    expect(section).not.toMatch(/trx\('(?:teams|users|team_members|task_assignments)'\)\s*\.(?:where|whereIn|update|del|delete|count|pluck|first)/);
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
  });
});
