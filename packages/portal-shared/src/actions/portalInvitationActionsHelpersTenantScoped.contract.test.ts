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

    expect(contactContext).toContain('createTenantScopedQuery(db, {');
    expect(contactContext).toContain("table: 'contacts'");
    expect(invitationTarget).toContain("table: 'portal_invitations as pi'");
    expect(clientUserTarget).toContain("table: 'users as u'");

    expect(contactContext).not.toMatch(/db\('contacts'\)\s*[\r\n]+\s*\.select[\s\S]*?\.where\(\{\s*tenant,/);
    expect(invitationTarget).not.toContain("'pi.tenant': tenant");
    expect(clientUserTarget).not.toContain("'u.tenant': tenant");
  });
});
