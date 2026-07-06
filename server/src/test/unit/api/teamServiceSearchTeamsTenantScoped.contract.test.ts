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

describe('team service searchTeams tenant-scoped query contract', () => {
  it('uses structural tenant scoping for searchTeams root', () => {
    const section = sectionBetween('async searchTeams', '* Get full team hierarchy');

    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('teams')");
    expect(section).toContain(".tenantJoin(query, 'users as manager', 'teams.manager_id', 'manager.user_id', { type: 'left' })");

    expect(section).not.toMatch(/knex\('teams'\)\s*\./);
    expect(section).not.toMatch(/\.where\('teams\.tenant', context\.tenant\)/);
  });
});
