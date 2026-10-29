'use server';

import { withAuth } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { CapabilityUnavailableError, requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { CoManagedPolicyError, coManagedDisplayName, requireCoManagedPolicyReader, evaluateCoManagedAccess, getCoManagedCollaborationPolicy, hasCoManagedLocalPermission,
  loadCoManagedLifecycleFacts, loadCoManagedStaffRoles, replaceCoManagedCustomerScope, replaceCoManagedStaffAssignments,
  type CoManagedCustomerScope, type CoManagedStaffAssignment } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { admitCoManagedSponsor } from '../co-managed/admitSponsor';
import { resolveCoManagedRelationshipTarget } from '../co-managed/relationshipTarget';

// Policy administration spans both sides of a relationship (the customer edits its grants, the
// sponsor edits staff assignments). The gate is by side: a customer workspace needs `serves`, a
// sponsor needs `admits` (and is the only side admitted into the permission catalog). Because the
// side is only known after the relationship is resolved, setup() first requires that some mode
// holds (so a closed capability costs no co-managed query), then asserts the side's own mode.
// The access-policy library still decides which side may do what.

type Failure = { ok: false; errorCode: 'FORBIDDEN' | 'PERMISSION_DENIED' | 'INVALID_POLICY' | 'POLICY_CHANGED' | 'RESOURCE_NOT_FOUND' };
const refusal = (error: unknown): Failure => {
  // Named refusals are expected outcomes the screen must show; a thrown error would reach the client redacted.
  if (error instanceof CoManagedPolicyError) return { ok: false, errorCode: error.code };
  throw error;
};

type Held = 'admits' | 'serves';

/**
 * A two-sided action's own gate. It runs inside the withAuth callback so the tenant handed to the adapter is the
 * session's (the entry-point contract checks this).
 */
function withCoManagedHeld<A extends unknown[], R>(work: (user: IUserWithRoles, ctx: { tenant: string; held: Held }, ...args: A) => Promise<R>) {
  return withAuth(async (user, { tenant }, ...args: A) => {
    // LEVERAGE: pattern capability-either-mode — a two-sided action needs "whichever mode holds"; a second such action should extract an adapter next to requireCapabilityForAction (and teach the entry-point contract about it).
    // `admits` first and short-circuiting: an admitted sponsor needs no participation read, and a forced-off or flag-off
    // non-participating tenant is refused here, before any co-managed table is read.
    let held: Held = 'admits';
    try { await requireCapabilityForAction('co-managed', tenant, 'admits'); }
    catch (error) {
      if (!(error instanceof CapabilityUnavailableError)) throw error;
      held = 'serves';
      await requireCapabilityForAction('co-managed', tenant, 'serves');
    }
    return work(user, { tenant, held }, ...args);
  });
}

async function setup(user: { user_id: string; user_type?: string }, tenant: string, held: Held, relationshipId: string) {
  if (user.user_type !== 'internal') throw new CoManagedPolicyError('FORBIDDEN');
  const { knex } = await createTenantKnex(tenant);
  const target = await resolveCoManagedRelationshipTarget(knex, tenant, relationshipId);
  if (held !== (target.side === 'sponsor' ? 'admits' : 'serves')) throw new CapabilityUnavailableError();
  if (target.side === 'sponsor') await admitCoManagedSponsor(tenant, knex);
  const actor = await coManagedBrowserActor(user, tenant);
  return { knex, actor: { tenant: actor.tenant, userId: actor.userId }, target };
}

/** The effective access view of one relationship: grants, assignments and display names for each. */
export const getCoManagedPolicyAction = withCoManagedHeld(async (user, { tenant, held }, relationshipId: string) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, held, relationshipId);
    const policy = await getCoManagedCollaborationPolicy(knex, actor, target);
    // Boards and projects are the customer's; assignment principals (users, teams) are always the sponsor's, whichever side is asking.
    const customer = tenantDb(knex, target.customerTenant), sponsor = tenantDb(knex, policy.sponsorTenant);
    const names = async (db: ReturnType<typeof tenantDb>, table: string, idColumn: string, label: (row: any) => string, ids: string[]) => {
      const out: Record<string, string> = {};
      if (ids.length) for (const row of await db.table(table).whereIn(idColumn, ids)) out[row[idColumn]] = label(row);
      return out;
    };
    const userIds = policy.assignments.filter(a => a.kind === 'user').map(a => a.principalId);
    const teamIds = policy.assignments.filter(a => a.kind === 'team').map(a => a.principalId);
    // The caller's own current permission, for enabling the editors. The write actions re-check it; this only avoids offering a dead end.
    const canManage = await hasCoManagedLocalPermission(knex, actor, 'co_management', 'manage');
    return { ok: true as const, side: target.side, policy, canManage,
      names: {
        boards: await names(customer, 'boards', 'board_id', r => r.board_name, policy.boards.map(b => b.id)),
        projects: await names(customer, 'projects', 'project_id', r => r.project_name, policy.projects.map(p => p.id)),
        users: await names(sponsor, 'users', 'user_id', r => coManagedDisplayName(r, r.username), userIds),
        teams: await names(sponsor, 'teams', 'team_id', r => r.team_name, teamIds),
      } };
  } catch (error) { return refusal(error); }
});

export const replaceCoManagedCustomerScopeAction = withCoManagedHeld(async (user, { tenant, held }, relationshipId: string,
  expectedRevision: number, scope: CoManagedCustomerScope) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, held, relationshipId);
    return { ok: true as const, revision: await replaceCoManagedCustomerScope(knex, actor, target, expectedRevision, scope) };
  } catch (error) { return refusal(error); }
});

export const replaceCoManagedStaffAssignmentsAction = withCoManagedHeld(async (user, { tenant, held }, relationshipId: string,
  expectedRevision: number, assignments: CoManagedStaffAssignment[]) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, held, relationshipId);
    return { ok: true as const, revision: await replaceCoManagedStaffAssignments(knex, actor, target, expectedRevision, assignments) };
  } catch (error) { return refusal(error); }
});

/** Sponsor-side candidates for the "why can't X see this" question: the workspace's active technicians. */
export const listCoManagedExplanationUsersAction = withCoManagedHeld(async (user, { tenant, held }, relationshipId: string) => {
  const { knex, actor, target } = await setup(user, tenant, held, relationshipId);
  if (target.side !== 'sponsor') return [];
  await withTransaction(knex, trx => requireCoManagedPolicyReader(trx, actor));
  const rows = await tenantDb(knex, tenant).table('users').where({ user_type: 'internal', is_inactive: false }).orderBy('first_name').orderBy('last_name').limit(500);
  return rows.map((row: any) => ({ userId: row.user_id as string, name: coManagedDisplayName(row, row.username as string) }));
});

export type CoManagedPolicyOptionKind = 'board' | 'project' | 'user' | 'team';
const OPTION_PAGE = 25;

/**
 * Candidates for the policy editors, as display names only. Boards and projects come from the customer's own
 * workspace (customer side only); users and teams from the sponsor's (sponsor side only). Searched and paged on the server.
 */
export const listCoManagedPolicyOptionsAction = withCoManagedHeld(async (user, { tenant, held }, relationshipId: string, kind: CoManagedPolicyOptionKind,
  search: string = '', page: number = 0) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, held, relationshipId);
    const customerKind = kind === 'board' || kind === 'project';
    if (!['board', 'project', 'user', 'team'].includes(kind) || target.side !== (customerKind ? 'customer' : 'sponsor') ||
        typeof search !== 'string' || search.length > 100 || !Number.isSafeInteger(page) || page < 0 || page > 10000) throw new CoManagedPolicyError('INVALID_POLICY');
    await withTransaction(knex, trx => requireCoManagedPolicyReader(trx, actor));
    const db = tenantDb(knex, tenant);
    const term = `%${search.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`;
    const query = kind === 'board' ? db.table('boards').select('board_id as id', 'board_name as name').where('board_name', 'ilike', term).orderBy('board_name')
      : kind === 'project' ? db.table('projects').select('project_id as id', 'project_name as name').where('project_name', 'ilike', term).orderBy('project_name')
      : kind === 'team' ? db.table('teams').select('team_id as id', 'team_name as name').where('team_name', 'ilike', term).orderBy('team_name')
      : db.table('users').select('user_id as id', 'first_name', 'last_name', 'username').where({ user_type: 'internal', is_inactive: false })
        .where(q => q.where('first_name', 'ilike', term).orWhere('last_name', 'ilike', term)).orderBy('first_name').orderBy('last_name');
    const rows = await query.limit(OPTION_PAGE + 1).offset(page * OPTION_PAGE);
    const options = rows.slice(0, OPTION_PAGE).map((row: any) => ({ id: row.id as string,
      name: kind === 'user' ? coManagedDisplayName(row, row.username as string) : (row.name as string) }));
    return { ok: true as const, options, hasMore: rows.length > OPTION_PAGE };
  } catch (error) { return refusal(error); }
});

/**
 * "Why can't X see this?" Loads the four layers' facts for one MSP user and one
 * customer board, then hands them to the single evaluator. It combines nothing itself.
 * Sponsor side only: staff assignments and home permissions live in the sponsor workspace.
 */
export const explainCoManagedAccessAction = withCoManagedHeld(async (user, { tenant, held }, relationshipId: string, subjectUserId: string, boardId: string) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, held, relationshipId);
    if (target.side !== 'sponsor') throw new CoManagedPolicyError('FORBIDDEN');
    return await withTransaction(knex, async trx => {
      await requireCoManagedPolicyReader(trx, actor);
      const home = tenantDb(trx, tenant);
      const subject = await home.table('users').where({ user_id: subjectUserId, user_type: 'internal' }).first('user_id');
      if (!subject) throw new CoManagedPolicyError('RESOURCE_NOT_FOUND');
      const lifecycle = await loadCoManagedLifecycleFacts(trx, tenant, target.customerTenant, relationshipId);
      if (!lifecycle?.relationship) throw new CoManagedPolicyError('FORBIDDEN');
      const teams = await home.table('team_members').where('user_id', subjectUserId).select('team_id');
      const subjectActor = { tenant, userId: subjectUserId };
      const roles = await loadCoManagedStaffRoles(trx, subjectActor, target.customerTenant, relationshipId, teams.map((t: any) => t.team_id));
      const scope = await tenantDb(trx, target.customerTenant).table('co_management_board_scopes')
        .where({ relationship_id: relationshipId, board_id: boardId }).first();
      const homeRead = await hasCoManagedLocalPermission(trx, subjectActor, 'ticket', 'read');
      const homeUpdate = await hasCoManagedLocalPermission(trx, subjectActor, 'ticket', 'update');
      const decision = evaluateCoManagedAccess({ lifecycle: lifecycle.lifecycle, staff: { roles },
        grant: { visibilityMode: lifecycle.relationship.visibility_mode, scope: scope ? { canCollaborate: scope.can_collaborate } : null, explicit: null },
        home: { read: homeRead, update: homeRead && homeUpdate } });
      return { ok: true as const, decision };
    });
  } catch (error) { return refusal(error); }
});
