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

  it('reads invitation state tenant-scoped, through the caller\'s own narrowing', () => {
    const stateQuery = sectionBetween(
      'export const getPortalInvitationStatesForClient',
      'export const sendBulkPortalInvitations'
    );

    expect(stateQuery).toContain('const scopedDb = tenantDb(trx, tenant);');
    expect(stateQuery).toContain("scopedDb.table('contacts as c')");
    expect(stateQuery).toContain("(await scope.narrowing('contact', 'c')).apply(query)");
    expect(stateQuery).toContain('joinOpenInvitations(scopedDb, query, trx)');
    expect(stateQuery).toContain("canManageClientPortalTargetClient(user, tenant, knex, 'read', normalizedClientId)");
    expect(stateQuery).toContain("scope.permits('client', normalizedClientId)");

    expect(stateQuery).not.toMatch(/\btrx\('contacts'\)/);
    expect(stateQuery).not.toContain("'pi.tenant': tenant");
  });

  it('builds the invitation-state filter and the state read from one predicate', () => {
    // The rule the MSP filtered on has to be the rule the batch acts on.
    expect(source).toContain("const HAS_OPEN_INVITATION_SQL = 'count(pi.invitation_id) > 0';");
    expect(source).toContain(
      "const HAS_ACTIVE_INVITATION_SQL = 'coalesce(bool_or(pi.expires_at > now()), false)';"
    );
    expect(source).toContain('.havingRaw(invitationStateHavingSql(invitationStates))');
    expect(source).toContain('${HAS_ACTIVE_INVITATION_SQL} as has_active_invitation');
    expect(source).toContain('${HAS_OPEN_INVITATION_SQL} as has_open_invitation');

    const joins = source.match(/joinOpenInvitations\(scopedDb, query, trx\)/g) ?? [];
    expect(joins).toHaveLength(2);
  });
});
