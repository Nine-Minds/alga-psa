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

describe('user actions delete basic tenant-scoped query contract', () => {
  it('uses structural tenant scoping for delete-user account-manager and reports-to roots', () => {
    const section = sectionBetween('export const deleteUser', 'export const updateUser');

    expect(section).toContain(".table('clients");
    expect(section).toContain(".table('users");
    expect(section).toContain('tenantDb(trx, tenantId)');

    expect(section).not.toMatch(/trx\('clients'\)\s*[\r\n]+\s*\.where\(\{\s*account_manager_id: userId,\s*tenant: tenant \|\| undefined\s*\}\)/);
    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where\(\{\s*reports_to: userId,\s*tenant:/);
  });
});
