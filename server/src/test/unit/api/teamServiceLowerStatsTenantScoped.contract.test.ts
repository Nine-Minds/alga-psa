import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TeamService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('team service lower statistics tenant-scoped query contract', () => {
  it('uses structural tenant scoping for getTeamStatistics roots', () => {
    const section = sectionBetween('async getTeamStatistics', '* Create team hierarchy relationship');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('teams')");
    expect(section).toContain(".table('teams as t')");
    expect(section).toContain('joinActiveMemberCounts(teamsWithMembersQuery, knex, context.tenant, \'t\')');
    expect(section).toContain("activeMemberCountsByTeamQuery(knex, context.tenant, 'size')");
    expect(source).toContain(".table('team_members as tm')");
    expect(source).toContain("tenantDb(knex, tenant).tenantJoinSubquery(");

    expect(section).not.toMatch(/knex\('(?:teams|teams as t|team_members)'\)\s*\./);
    expect(section).not.toMatch(/\.where\('t\.tenant', context\.tenant\)/);
    expect(section).not.toMatch(/\.where\(\{ tenant: context\.tenant \}\)/);
  });
});
