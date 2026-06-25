import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'registrationActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

describe('registration actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping after contact tenant resolution', () => {
    const section = sectionFrom('async function registerContactUser');

    expect(section).toContain('createTenantScopedQuery(trx, {');
    expect(section).toContain("table: 'users'");
    expect(section).toContain("table: 'roles'");
    expect(section).toContain('tenant: contact.tenant');
    expect(section).toContain("const [user] = await trx('users')");
    expect(section).toContain("await trx('user_roles').insert({");

    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/trx\('roles'\)\.where\(\{\s*tenant: contact\.tenant\s*\}\)/);
  });
});
