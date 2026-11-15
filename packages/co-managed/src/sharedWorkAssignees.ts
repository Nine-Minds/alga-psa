import { tenantDb } from '@alga-psa/db';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import { evaluateCoManagedAccess } from './policy';
import { coManagedDisplayName } from './actorReferences';
import { CoManagedSharedWorkError, lockCoManagedActiveHomeIdentity } from './sharedWorkIdentity';
import { loadCoManagedGrantFacts, loadCoManagedHomeFacts, loadCoManagedLifecycleFacts, loadCoManagedStaffRoles,
  type CoManagedSharedWorkContext } from './sharedWork';

export interface CoManagedAssignee { tenant: string; kind: 'user' | 'team'; id: string }
export interface CoManagedAssigneeOption extends CoManagedAssignee { name: string; organizationName: string }
export interface CoManagedAssigneePolicy { boardId?: string; hidden: (fields: readonly string[]) => boolean }
const denied = (): never => { throw new CoManagedSharedWorkError(); };

/**
 * A proposed assignee must pass the SAME access matrix as an acting MSP user:
 * their own staff roles, the resource grant, their home RBAC and the live
 * relationship, combined only by `evaluateCoManagedAccess`. Candidate
 * authorization never grants a session or substitutes for the editor's authority.
 * `teamId` scopes the candidate to the assignment made through that team.
 */
async function eligiblePerson(context: CoManagedSharedWorkContext, userId: string, policy: CoManagedAssigneePolicy, teamId?: string) {
  const { trx, resource } = context;
  const sponsor = await tenantDb(trx, resource.tenant).table('co_management_relationships').where('relationship_id', resource.relationshipId).first('sponsor_tenant');
  const candidate = { tenant: sponsor?.sponsor_tenant as string, userId };
  if (!candidate.tenant) return denied();
  const lifecycle = await loadCoManagedLifecycleFacts(trx, candidate.tenant, resource.tenant, resource.relationshipId);
  if (!lifecycle?.relationship) return denied();
  const subject = await lockCoManagedActiveHomeIdentity(trx, candidate);
  if (teamId && !subject.teamIds?.includes(teamId)) denied();
  const roles = await loadCoManagedStaffRoles(trx, candidate, resource.tenant, resource.relationshipId, subject.teamIds ?? []);
  const grant = await loadCoManagedGrantFacts(trx, resource, lifecycle.relationship.visibility_mode);
  if (!grant) return denied();
  const record: AuthorizationRecord = { id: `${resource.tenant}:${resource.kind}:${resource.id}`, clientId: lifecycle.relationship.sponsor_client_id,
    boardId: policy.boardId, assignedUserIds: teamId ? [] : [userId], teamIds: teamId ? [teamId] : [] };
  const home = await loadCoManagedHomeFacts(trx, candidate, subject, resource.kind === 'ticket' ? 'ticket' : 'project', record);
  const decision = evaluateCoManagedAccess({ lifecycle: lifecycle.lifecycle, staff: { roles }, grant, home: home.facts });
  // Assignment is a write-class action: the candidate must be able to work the item, not only see it.
  if (!decision.write || !roles.includes('technician') || policy.hidden(home.redactedFields)) denied();
  return candidate;
}

/** Validates one proposed assignee and returns a display option. Absent names fall back through `coManagedDisplayName`. */
export async function coManagedAssigneeOption(context: CoManagedSharedWorkContext, assignee: CoManagedAssignee, policy: CoManagedAssigneePolicy): Promise<CoManagedAssigneeOption> {
  const { trx, resource } = context;
  const relation = await tenantDb(trx, resource.tenant).table('co_management_relationships').where('relationship_id', resource.relationshipId).first('sponsor_tenant');
  if (!relation || assignee.tenant !== relation.sponsor_tenant) denied();
  const home = tenantDb(trx, relation.sponsor_tenant);
  const organization = await home.table('tenants').forShare().first('client_name');
  if (!organization) denied();
  let name: string;
  if (assignee.kind === 'user') {
    await eligiblePerson(context, assignee.id, policy);
    const user = await home.table('users').where('user_id', assignee.id).first('first_name', 'last_name', 'email');
    name = coManagedDisplayName(user, user?.email || assignee.id);
  } else {
    const team = await home.table('teams').where('team_id', assignee.id).forShare().first('team_name');
    if (!team) denied();
    const members = await home.table('team_members').where('team_id', assignee.id).orderBy('user_id').forShare().select('user_id');
    let eligible = false;
    for (const member of members) {
      try { await eligiblePerson(context, member.user_id, policy, assignee.id); eligible = true; break; }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
    }
    if (!eligible) denied();
    name = team.team_name;
  }
  return { ...assignee, name, organizationName: organization.client_name || assignee.tenant };
}
