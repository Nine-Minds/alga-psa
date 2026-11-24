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
    expect(stateQuery).toContain('joinContactInvitations(scopedDb, query)');
    expect(stateQuery).toContain("canManageClientPortalTargetClient(user, tenant, knex, 'read', normalizedClientId)");
    expect(stateQuery).toContain("scope.permits('client', normalizedClientId)");

    expect(stateQuery).not.toMatch(/\btrx\('contacts'\)/);
    expect(stateQuery).not.toContain("'pi.tenant': tenant");
  });

  it('builds the invitation-state filter and the state read from one predicate', () => {
    // The rule the MSP filtered on has to be the rule the batch acts on: one
    // SQL expression, read as a column and reused as the HAVING predicate.
    expect(source).toContain('invitationStateHaving,');
    expect(source).toContain('LATEST_INVITATION_STATE_SQL,');
    expect(source).toContain('${LATEST_INVITATION_STATE_SQL}) as invitation_state');
    expect(source).toContain('const having = invitationStateHaving(states);');
    expect(source).toContain('query.groupBy(...groupColumns).havingRaw(having.sql, having.bindings);');

    // Every classification joins every invitation row, because the state of a
    // contact is the state of its latest invitation.
    const joins = source.match(/joinContactInvitations\(scopedDb, query\)/g) ?? [];
    expect(joins).toHaveLength(3);
    expect(source).not.toContain("join.andOn(trx.raw('pi.used_at is null'))");
  });
});
