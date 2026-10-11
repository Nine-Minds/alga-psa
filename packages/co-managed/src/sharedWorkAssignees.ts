import { tenantDb } from '@alga-psa/db';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError, lockCoManagedActiveHomeIdentity, authorizeCoManagedWorkRecord } from './sharedWorkIdentity';

export interface CoManagedAssignee { tenant: string; kind: 'user' | 'team'; id: string }
export interface CoManagedAssigneeOption extends CoManagedAssignee { name: string; organizationName: string }
interface AssigneePolicy { boardId?: string; hidden: (fields: readonly string[]) => boolean }
const denied = (): never => { throw new CoManagedSharedWorkError(); };

/** Candidate authorization uses the proposed assignment as the home-policy
 * record. It never grants a session or substitutes for the editor's authority. */
async function eligiblePerson(context: CoManagedSharedWorkContext, relation: any, userId: string, policy: AssigneePolicy, teamId?: string) {
  const candidate = { tenant: relation.sponsor_tenant as string, userId }, home = tenantDb(context.trx, candidate.tenant);
  const subject = await lockCoManagedActiveHomeIdentity(context.trx, candidate);
  if (teamId && !subject.teamIds?.includes(teamId)) denied();
  const staff = await home.table('co_management_staff_assignments').where({ customer_tenant: context.resource.tenant,
    relationship_id: context.resource.relationshipId, relationship_role: 'technician' })
    .where(query => query.where({ principal_type: 'user', principal_id: userId }).orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', subject.teamIds ?? []))).forShare();
  if (!staff.length) denied();
  const record = { id: `${context.resource.tenant}:${context.resource.kind}:${context.resource.id}`, clientId: relation.sponsor_client_id, boardId: policy.boardId,
    assignedUserIds: teamId ? [] : [userId], teamIds: teamId ? [teamId] : [] };
  for (const action of ['read', 'update'] as const) {
    const permission = await authorizeCoManagedWorkRecord(context.trx, candidate, subject, context.resource.kind === 'ticket' ? 'ticket' : 'project', action, record);
    if (policy.hidden(permission.redactedFields)) denied();
  }
}
export async function coManagedAssigneeOption(context: CoManagedSharedWorkContext, relation: any, assignee: CoManagedAssignee, policy: AssigneePolicy): Promise<CoManagedAssigneeOption> {
  if (assignee.tenant !== relation.sponsor_tenant) denied();
  const home = tenantDb(context.trx, relation.sponsor_tenant);
  const organization = await home.table('tenants').forShare().first('client_name', 'product_code', 'suspended_at');
  if (organization?.product_code !== 'psa' || organization.suspended_at) denied();
  let name: string;
  if (assignee.kind === 'user') {
    await eligiblePerson(context, relation, assignee.id, policy);
    const user = await home.table('users').where('user_id', assignee.id).first('first_name', 'last_name', 'email');
    name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || assignee.id;
  } else {
    const team = await home.table('teams').where('team_id', assignee.id).forShare().first('team_name');
    if (!team || !await home.table('co_management_staff_assignments').where({ customer_tenant: context.resource.tenant,
      relationship_id: context.resource.relationshipId, principal_type: 'team', principal_id: assignee.id, relationship_role: 'technician' }).forShare().first()) denied();
    const members = await home.table('team_members').where('team_id', assignee.id).orderBy('user_id').forShare().select('user_id');
    let eligible = false;
    for (const member of members) {
      try { await eligiblePerson(context, relation, member.user_id, policy, assignee.id); eligible = true; break; }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
    }
    if (!eligible) denied(); name = team.team_name;
  }
  return { ...assignee, name, organizationName: organization.client_name || assignee.tenant };
}
