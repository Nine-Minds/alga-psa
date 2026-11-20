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

    expect(section).toContain('const scopedDb = tenantDb(knex, tenant);');
    expect(section).toContain("scopedDb.table('users')");
    expect(section).toContain("scopedDb.table('contacts')");
    expect(section).toContain("scopedDb.table('roles')");
    // user_roles is written through @alga-psa/db, which carries the contact's
    // portal-admin flag sync and keeps its own tenant-scoping contract
    // (userRoleWritesTenantScoped.contract.test.ts); alga-2026-0003347.
    expect(section).toContain('await addUserRoles(trx, tenant, newUser.user_id, [role.role_id]);');
    // The user row is already committed by then, so the role write opens its own
    // transaction — the flag sync still commits with the role.
    expect(section).toContain('await withTransaction(knex, async (trx: Knex.Transaction) => {');

    expect(section).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.where\(\{\s*user_id: existingUser\.user_id,\s*tenant\s*\}\)/);
    expect(section).not.toMatch(/knex\('contacts'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
    expect(section).not.toMatch(/knex\('roles'\)\s*[\r\n]+\s*\.where\(\{\s*tenant,/);
  });

  it('relinks an orphaned portal account through the shared tenant-scoped lookup', () => {
    const section = sectionBetween('export async function completePortalSetup', 'export const getPortalInvitations');

    expect(section).toContain('const existingEmailOwner = await findPortalEmailOwner(knex, tenant, contact.email);');
    expect(section).toContain("classifyPortalEmailOwner(existingEmailOwner, contact.contact_name_id) === 'orphaned'");
    expect(section).toContain('completeSetupForExistingUser(existingEmailOwner, contact.contact_name_id)');
    expect(section).toContain('relinkOrphanedPortalUser(trx, tenant, existingUser.user_id, relinkContactId)');
    expect(section).toContain("errorCode: 'PORTAL_USER_ALREADY_EXISTS'");
    // The hand-scoped `knex('users').where({ tenant })` owner probe is gone.
    expect(section).not.toContain("await knex('users')");
  });
});
