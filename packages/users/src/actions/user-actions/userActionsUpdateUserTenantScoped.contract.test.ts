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

describe('user actions update user tenant-scoped query contract', () => {
  it('uses structural tenant scoping for update-user board and user roots', () => {
    const section = sectionBetween('export const updateUser', 'export const updateUserRoles');

    expect(section).toContain(".table('boards");
    expect(section).toContain(".table('users");
    expect(section).toContain('findExistingUserByEmailGlobally(normalizedEmail');
    expect(section).toContain('await User.update(trx, userId, normalizedUserData)');

    expect(section).not.toMatch(/trx\('boards'\)\s*[\r\n]+\s*\.where\(\{\s*default_assigned_to: userId,\s*tenant\s*\}\)/);
    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where\(\{\s*user_id: userId,\s*tenant: tenant \|\| undefined\s*\}\)/);
  });
});
