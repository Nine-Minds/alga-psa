import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user actions add-user tenant-scoped query contract', () => {
  it('uses structural tenant scoping for safe user lookup and tenant-known add-user reads', () => {
    const helperSection = sectionBetween('async function getSafeUserWithRoles', 'async function findExistingUserByEmailGlobally');
    const addUserSection = sectionBetween('export const addUser', 'export const deleteUser');

    expect(helperSection).toContain('createTenantScopedQuery(trx, {');
    expect(helperSection).toContain("table: 'users'");
    expect(addUserSection).toContain('createTenantScopedQuery(trx, {');
    expect(addUserSection).toContain("table: 'tenants'");
    expect(addUserSection).toContain("table: 'roles'");
    expect(addUserSection).toContain("table: 'users'");
    expect(addUserSection).toContain("const [newUser] = await trx('users')");
    expect(addUserSection).toContain("await trx('user_roles').insert({");

    expect(helperSection).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where/);
    expect(addUserSection).not.toMatch(/trx\('tenants'\)\s*[\r\n]+\s*\.where\(\{\s*tenant\s*\}\)/);
    expect(addUserSection).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where/);
    expect(addUserSection).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where/);
    expect(addUserSection).not.toMatch(/\.where\(\{\s*role_id: userData\.roleId,\s*tenant/);
  });
});
