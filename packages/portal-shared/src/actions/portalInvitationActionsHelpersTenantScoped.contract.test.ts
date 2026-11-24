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

describe('portal invitation action helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for helper authorization roots', () => {
    const contactContext = sectionBetween(
      'async function getContactAuthContext',
      'async function getClientPortalActorContact'
    );
    const invitationTarget = sectionBetween(
      'async function resolveInvitationTargetClientId',
      'async function resolveClientUserTargetClientId'
    );
    const clientUserTarget = sectionBetween(
      'async function resolveClientUserTargetClientId',
      'export const createClientPortalUser'
    );

    expect(contactContext).toContain('tenantDb(db, ');
    expect(contactContext).toContain(".table('contacts");
    expect(invitationTarget).toContain(".table('portal_invitations as pi");
    expect(clientUserTarget).toContain(".table('users as u");

    expect(contactContext).not.toMatch(/db\('contacts'\)\s*[\r\n]+\s*\.select[\s\S]*?\.where\(\{\s*tenant,/);
    expect(invitationTarget).not.toContain("'pi.tenant': tenant");
    expect(clientUserTarget).not.toContain("'u.tenant': tenant");
  });

  /**
   * Relinking an orphaned account changes `users.contact_id` and writes no
   * role, so the flag of the contact it now points at has to be re-derived
   * from the roles that account already holds — otherwise a plain 'User'
   * account adopted by a contact pre-marked as portal admin keeps that
   * contact's company-wide portal scope (alga-2026-0003347).
   */
  it('re-derives the portal admin flag of both contacts when it relinks an account', () => {
    const relink = sectionBetween(
      'async function relinkOrphanedPortalUser',
      'export const createClientPortalUser'
    );

    const previous = relink.indexOf(".first('contact_id')");
    const write = relink.indexOf('.update({ contact_id: contactId');
    const sync = relink.indexOf('await syncContactClientAdminFlagsForUserLinkChange(db, tenant, userId,');

    expect(previous).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(previous);
    expect(sync).toBeGreaterThan(write);
  });
});
