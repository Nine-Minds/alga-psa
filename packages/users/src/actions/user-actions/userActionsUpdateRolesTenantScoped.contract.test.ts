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

describe('user actions update roles tenant-scoped query contract', () => {
  it('uses structural tenant scoping for user-role deletion', () => {
    const section = sectionBetween('export const updateUserRoles', 'export async function verifyContactEmail');

    // user_roles is written through @alga-psa/db, which carries the contact's
    // portal-admin flag sync and keeps its own tenant-scoping contract
    // (userRoleWritesTenantScoped.contract.test.ts); alga-2026-0003347.
    expect(section).toContain('await setUserRoles(trx, tenant, userId, roleIds);');

    expect(section).not.toMatch(/trx\('user_roles'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/\.where\(\{\s*user_id: userId,\s*tenant: tenant \|\| undefined\s*\}\)/);
  });
});
