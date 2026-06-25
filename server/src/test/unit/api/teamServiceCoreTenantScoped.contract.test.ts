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

describe('team service core tenant-scoped query contract', () => {
  it('uses structural tenant scoping for list/get roots and hydration lookups', () => {
    const section = sectionBetween('// Core CRUD Operations', '* Create new team');

    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain("table: 'teams as t'");
    expect(section).toContain("table: 'team_members'");
    expect(section).toContain("table: 'users'");

    expect(section).not.toMatch(/knex\('(?:teams as t|team_members|users)'\)\s*\./);
    expect(section).not.toMatch(/\.where\('(?:t\.)?tenant', (?:context|team)\.tenant\)/);
    expect(section).not.toMatch(/\.where\(\{[^}]*tenant: (?:context|team)\.tenant/);
  });
});
