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

describe('user actions register client user tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known client-role lookup', () => {
    const section = sectionBetween('export const registerClientUser', 'export const checkPasswordResetStatus');

    expect(section).toContain("await trx('contacts')");
    expect(section).toContain('findExistingUserByEmailGlobally(email');
    expect(section).toContain("await trx('users')");
    expect(section).toContain("await trx('user_roles').insert");
    expect(section).toContain("table: 'roles'");
    expect(section).toContain('tenant: contact.tenant');
    expect(section).toContain("whereRaw('LOWER(role_name) = ?', ['user'])");

    expect(section).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where\(\{\s*tenant: contact\.tenant,/);
  });
});
