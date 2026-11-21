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

    expect(section).toContain('const scopedDb = tenantDb(trx, tenant);');
    expect(section).toContain("scopedDb.table('contacts')");
    expect(section).toContain("scopedDb.table('users')");
    expect(section).toContain("scopedDb.table('roles')");
    expect(section).toContain("[created] = await scopedDb.table('users')");
    expect(section).toContain("await scopedDb.table('user_roles').insert({");

    expect(section).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.where\(\{\s*tenant/);
    expect(section).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });

  it('resolves the email owner before the tenant-wide uniqueness refusals', () => {
    const section = sectionBetween('export const createClientPortalUser', 'export const sendPortalInvitation');

    const ownerLookup = section.indexOf('findPortalEmailOwner(trx, tenant, contact.email)');
    const emailRefusal = section.indexOf(
      "throw new Error('A user with this email already exists in this organization')"
    );

    expect(ownerLookup).toBeGreaterThan(-1);
    expect(emailRefusal).toBeGreaterThan(ownerLookup);
    expect(section).toContain("classifyPortalEmailOwner(emailOwner, contact.contact_name_id)");
    expect(section).toContain("'PORTAL_USER_ALREADY_EXISTS'");
    expect(section).toContain('relinkOrphanedPortalUser(trx, tenant, emailOwner.user_id, contact.contact_name_id)');
    // A relinked account keeps the client role it already held.
    expect(section).toContain("scopedDb.table('user_roles as ur')");
    expect(section).toContain("scopedDb.tenantJoin(existingClientRoleQuery, 'roles as r', 'ur.role_id', 'r.role_id');");
    expect(section).not.toMatch(/trx\('user_roles'\)/);
  });
});
