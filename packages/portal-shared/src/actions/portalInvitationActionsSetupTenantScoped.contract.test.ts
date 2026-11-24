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
    // The role of a new portal account is resolved from the contact's
    // portal-admin pre-mark, and user_roles is written, through @alga-psa/db:
    // both keep their own tenant-scoping contract and the write carries the
    // flag sync (alga-2026-0003347).
    expect(section).toContain('await resolveInitialPortalRoleId(trx, tenant, contact.contact_name_id);');
    expect(section).toContain('await addUserRoles(trx, tenant, user.user_id, [roleId]);');
    // Both run in the transaction that creates the account, so a role that
    // cannot be resolved rolls the account back instead of leaving it with no
    // role at all.
    expect(section).not.toContain('await withTransaction(knex, async (trx: Knex.Transaction) => {');
    expect(section).toMatch(/newUser = await knex\.transaction\(async \(trx\) => \{[\s\S]*resolveInitialPortalRoleId[\s\S]*addUserRoles[\s\S]*\}\);/);

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
