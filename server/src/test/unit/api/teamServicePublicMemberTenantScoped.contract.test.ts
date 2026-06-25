import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TeamService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetweenLast(startMarker: string, endMarker: string): string {
  const start = source.lastIndexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('team service public member tenant-scoped query contract', () => {
  it('uses structural tenant scoping for lower member API roots', () => {
    const section = sectionBetweenLast('// Team Member Management', '* Get team statistics');

    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain("table: 'teams'");
    expect(section).toContain("table: 'users'");
    expect(section).toContain("table: 'team_members'");
    expect(section).toContain("table: 'team_members as tm'");

    expect(section).not.toMatch(/knex\('(?:teams|team_members as tm)'\)\s*\./);
    expect(section).not.toMatch(/trx\('(?:teams|users|team_members)'\)\s*\.(?:where|whereIn|delete|pluck|first|select)/);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: context\.tenant/);
  });
});
