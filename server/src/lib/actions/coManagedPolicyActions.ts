'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { CoManagedPolicyError, evaluateCoManagedAccess, getCoManagedCollaborationPolicy, hasCoManagedLocalPermission,
  loadCoManagedLifecycleFacts, loadCoManagedStaffRoles, replaceCoManagedCustomerScope, replaceCoManagedStaffAssignments,
  type CoManagedCustomerScope, type CoManagedStaffAssignment } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { admitCoManagedSponsor } from '../co-managed/admitSponsor';
import { resolveCoManagedRelationshipTarget } from '../co-managed/relationshipTarget';

// Policy administration spans both sides of a relationship (the customer edits
// its grants, the sponsor edits staff assignments), so each action gates on
// `admits` and the access-policy library decides which side may do what.

type Failure = { ok: false; errorCode: 'FORBIDDEN' | 'INVALID_POLICY' | 'POLICY_CHANGED' | 'RESOURCE_NOT_FOUND' };
const refusal = (error: unknown): Failure => {
  // Named refusals are expected outcomes the screen must show; a thrown error would reach the client redacted.
  if (error instanceof CoManagedPolicyError) return { ok: false, errorCode: error.code };
  throw error;
};

async function setup(user: { user_id: string; user_type?: string }, tenant: string, relationshipId: string) {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type !== 'internal') throw new CoManagedPolicyError('FORBIDDEN');
  const { knex } = await createTenantKnex(tenant);
  await admitCoManagedSponsor(tenant, knex);
  const actor = await coManagedBrowserActor(user, tenant);
  const target = await resolveCoManagedRelationshipTarget(knex, tenant, relationshipId);
  return { knex, actor: { tenant: actor.tenant, userId: actor.userId }, target };
}

/** The effective access view of one relationship: grants, assignments and display names for each. */
export const getCoManagedPolicyAction = withAuth(async (user, { tenant }, relationshipId: string) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    const policy = await getCoManagedCollaborationPolicy(knex, actor, target);
    const customer = tenantDb(knex, target.customerTenant), home = tenantDb(knex, tenant);
    const names = async (db: ReturnType<typeof tenantDb>, table: string, idColumn: string, label: (row: any) => string, ids: string[]) => {
      const out: Record<string, string> = {};
      if (ids.length) for (const row of await db.table(table).whereIn(idColumn, ids)) out[row[idColumn]] = label(row);
      return out;
    };
    const userIds = policy.assignments.filter(a => a.kind === 'user').map(a => a.principalId);
    const teamIds = policy.assignments.filter(a => a.kind === 'team').map(a => a.principalId);
    return { ok: true as const, side: target.side, policy,
      names: {
        boards: await names(customer, 'boards', 'board_id', r => r.board_name, policy.boards.map(b => b.id)),
        projects: await names(customer, 'projects', 'project_id', r => r.project_name, policy.projects.map(p => p.id)),
        users: await names(home, 'users', 'user_id', r => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.username, userIds),
        teams: await names(home, 'teams', 'team_id', r => r.team_name, teamIds),
      } };
  } catch (error) { return refusal(error); }
});

export const replaceCoManagedCustomerScopeAction = withAuth(async (user, { tenant }, relationshipId: string,
  expectedRevision: number, scope: CoManagedCustomerScope) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, revision: await replaceCoManagedCustomerScope(knex, actor, target, expectedRevision, scope) };
  } catch (error) { return refusal(error); }
});

export const replaceCoManagedStaffAssignmentsAction = withAuth(async (user, { tenant }, relationshipId: string,
  expectedRevision: number, assignments: CoManagedStaffAssignment[]) => {
  try {
    const { knex, actor, target } = await setup(user, tenant, relationshipId);
    return { ok: true as const, revision: await replaceCoManagedStaffAssignments(knex, actor, target, expectedRevision, assignments) };
  } catch (error) { return refusal(error); }
});

/** Sponsor-side candidates for the "why can't X see this" question: the workspace's active technicians. */
export const listCoManagedExplanationUsersAction = withAuth(async (user, { tenant }, relationshipId: string) => {
  const { knex, target } = await setup(user, tenant, relationshipId);
  if (target.side !== 'sponsor') return [];
  const rows = await tenantDb(knex, tenant).table('users').where({ user_type: 'internal', is_inactive: false }).orderBy('first_name').orderBy('last_name').limit(500);
  return rows.map((row: any) => ({ userId: row.user_id as string, name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || (row.username as string) }));
});

/**
 * "Why can't X see this?" Loads the four layers' facts for one MSP user and one
 * customer board, then hands them to the single evaluator. It combines nothing itself.
 * Sponsor side only: staff assignments and home permissions live in the sponsor workspace.
 */
export const explainCoManagedAccessAction = withAuth(async (user, { tenant }, relationshipId: string, subjectUserId: string, boardId: string) => {
  try {
    const { knex, target } = await setup(user, tenant, relationshipId);
    if (target.side !== 'sponsor') throw new CoManagedPolicyError('FORBIDDEN');
    return await withTransaction(knex, async trx => {
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
