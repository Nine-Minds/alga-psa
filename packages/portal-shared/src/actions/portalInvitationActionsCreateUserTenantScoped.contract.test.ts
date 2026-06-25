import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'portalInvitationActions.ts');
const source = readFileSync(sourcePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('portal invitation create-user tenant-scoped query contract', () => {
  it('uses a transaction-local tenant-scoped root helper for tenant-known reads', () => {
    const section = sectionBetween('export const createClientPortalUser', 'export const sendPortalInvitation');

    expect(section).toContain('const tenantScopedTable = (table: string) => tenantDb(trx, ');
    expect(section).toContain("tenantScopedTable('contacts')");
    expect(section).toContain("tenantScopedTable('users')");
    expect(section).toContain("tenantScopedTable('roles')");
    expect(section).toContain("const [created] = await trx('users')");
    expect(section).toContain("await trx('user_roles').insert({");

    expect(section).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where\(\{\s*tenant/);
    expect(section).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
