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

describe('portal invitation send flow tenant-scoped query contract', () => {
  it('uses structural tenant scoping for send-invitation preflight and transaction reads', () => {
    const section = sectionBetween('export const sendPortalInvitation', 'export async function verifyPortalToken');

    expect(section).toContain('createTenantScopedQuery(knex, {');
    expect(section).toContain("table: 'contacts'");
    expect(section).toContain("table: 'users'");
    expect(section).toContain('const tenantScopedTable = (table: string) => createTenantScopedQuery(trx, {');
    expect(section).toContain("tenantScopedTable('tenant_companies')");
    expect(section).toContain("tenantScopedTable('client_locations')");
    expect(section).toContain("tenantScopedTable('clients')");

    expect(section).not.toMatch(/knex\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\('tenant_companies'\)\s*[\r\n]+\s*\.join/);
    expect(section).not.toMatch(/trx\('client_locations'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\('clients'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toContain("'tenant_companies.tenant': tenant");
  });
});
