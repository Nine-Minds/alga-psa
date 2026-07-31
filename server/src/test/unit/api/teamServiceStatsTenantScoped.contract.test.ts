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

describe('team service statistics tenant-scoped query contract', () => {
  it('uses structural tenant scoping for statistics roots', () => {
    const section = sectionBetween('// Statistics and Reporting', '// HATEOAS Link Generation');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('teams as t')");
    expect(section).toContain('joinActiveMemberCounts(totalStatsQuery, knex, context.tenant, \'t\'');
    expect(section).toContain('joinActiveMemberCounts(largestTeamQuery, knex, context.tenant, \'t\'');
    expect(source).toContain("tenantDb(knex, tenant).tenantJoinSubquery(");
    expect(source).toContain(".table('team_members as tm')");

    expect(section).not.toMatch(/knex\('(?:teams|team_members)'\)\s*\./);
    expect(section).not.toContain('JOIN users u ON tm.user_id = u.user_id AND tm.tenant = u.tenant');
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
    expect(section).not.toMatch(/\.where\(\{ tenant: context\.tenant \}\)/);
  });
});
