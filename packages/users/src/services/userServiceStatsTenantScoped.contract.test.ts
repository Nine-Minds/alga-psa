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

describe('user service statistics tenant-scoped query contract', () => {
  it('uses structural tenant scoping for user statistics aggregate roots', () => {
    const section = sectionBetween('async getUserStats', 'async getUserActivityLogs');

    expect(section).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(section).toContain('tenantDb(knex, ');
    expect(section).toContain(".table('users as u");
    expect(section).toContain(".table('users as u");

    expect(section).not.toMatch(/knex\('users'\)\s*\./);
    expect(section).not.toMatch(/knex\('users as u'\)\s*\./);
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
    expect(section).not.toMatch(/\.where\('u\.tenant', context\.tenant\)/);
  });
});
