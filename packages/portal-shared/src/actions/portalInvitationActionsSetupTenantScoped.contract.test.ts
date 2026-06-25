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

describe('portal invitation setup tenant-scoped query contract', () => {
  it('uses structural tenant scoping for setup user, contact, and role roots', () => {
    const section = sectionBetween('export async function completePortalSetup', 'export const getPortalInvitations');

    expect(section).toContain('const tenantScopedTable = (table: string) => tenantDb(knex, ');
    expect(section).toContain("tenantScopedTable('users')");
    expect(section).toContain("tenantScopedTable('contacts')");
    expect(section).toContain("tenantScopedTable('roles')");
    expect(section).toContain("await knex('user_roles').insert({");

    expect(section).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.where\(\{\s*user_id: existingUser\.user_id,\s*tenant\s*\}\)/);
    expect(section).not.toMatch(/knex\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/knex\('roles'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });
});
