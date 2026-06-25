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

describe('user service role management tenant-scoped query contract', () => {
  it('uses structural tenant scoping for role assignment and removal roots', () => {
    const section = sectionBetween('async assignRoles', 'TEAM MEMBERSHIPS');

    expect(section).toContain('this.buildTenantScopedQuery(trx, context)');
    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain("table: 'roles'");
    expect(section).toContain("table: 'user_roles'");
    expect(section).toContain("await trx('user_roles').insert(userRoles)");

    expect(section).not.toMatch(/trx\('users'\)\s*\./);
    expect(section).not.toMatch(/trx\('roles'\)\s*\./);
    expect(section).not.toMatch(/trx\('user_roles'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/\.where\(\{\s*user_id: userId,\s*tenant: context\.tenant\s*\}\)/);
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });
});
