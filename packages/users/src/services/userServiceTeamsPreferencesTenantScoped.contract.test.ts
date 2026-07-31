import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, 'UserService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user service team and preferences tenant-scoped query contract', () => {
  it('uses structural tenant scoping for team and preference read roots', () => {
    const section = sectionBetween('TEAM MEMBERSHIPS', 'SEARCH & FILTERING');

    expect(section).toContain('tenantDb(knex, ');
    expect(section).toContain(".table('teams as t");
    expect(section).toContain(".table('teams as t");
    expect(section).toContain(".table('user_preferences");

    expect(section).not.toMatch(/knex\('teams as t'\)\s*\./);
    expect(section).not.toMatch(/knex\('user_preferences'\)\s*\./);
    expect(section).not.toMatch(/'t\.tenant': context\.tenant/);
    expect(section).not.toMatch(/\.where\(\{\s*user_id: userId,\s*tenant: context\.tenant\s*\}\)/);
  });
});
