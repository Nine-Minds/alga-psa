import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { createAuthorizationKernel, BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider,
  resolveBundleNarrowingRulesForEvaluation, type AuthorizationRecord, type ScopeConstraint } from '@alga-psa/authorization';
import { hasCoManagedLocalPermission } from './localPermission';
import type { CoManagedHomeActor } from './policy';

/** Created from a verified session by the authentication adapter, never request JSON. */
export interface CoManagedSessionActor extends CoManagedHomeActor { kind: 'session'; sessionId: string }
export interface CoManagedSharedResource {
  tenant: string;
  relationshipId: string;
  kind: 'ticket' | 'project' | 'project_task';
  id: string;
}
export interface CoManagedSharedWorkContext {
  trx: Knex.Transaction;
  actor: CoManagedHomeActor;
  resource: CoManagedSharedResource;
  revision: number;
  action: 'read' | 'update';
  /** The command must omit these home-policy fields from its response. */
  redactedFields: readonly string[];
}
export class CoManagedSharedWorkError extends Error {
  readonly code = 'CO_MANAGED_SHARED_WORK_FORBIDDEN';
  constructor() { super('This shared resource is not available for the requested operation.'); this.name = 'CoManagedSharedWorkError'; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function deny(): never { throw new CoManagedSharedWorkError(); }

function matchesConstraints(constraints: ScopeConstraint[], record: AuthorizationRecord): boolean {
  // Home policy IDs never compare with bare customer IDs. Unsupported fields
  // fail closed until a qualified MSP work reference can supply their meaning.
  const fields: Record<string, unknown> = { client_id: record.clientId, board_id: record.boardId,
    owner_user_id: record.ownerUserId, assigned_to: record.assignedUserIds?.[0] };
  return constraints.every(constraint => {
    if (!(constraint.field in fields) || fields[constraint.field] === undefined) return false;
    if (constraint.operator === 'eq') return fields[constraint.field] === constraint.value;
    if (constraint.operator === 'in' && Array.isArray(constraint.value)) return constraint.value.includes(fields[constraint.field]);
    return false;
  });
}

/** Retains trust, identity, grants and resource locks through the command.
 * It never changes AsyncLocalStorage/session tenant. This base resource grant
 * does not authorize linked documents, credentials, comments, or attachments;
 * their commands must additionally apply the audience/resource-specific policy.
 * Session-backed MSP work is supported here; other principal kinds fail closed
 * until their own authenticated adapter and narrowing rules are connected. */
export async function withCoManagedSharedWork<T>(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  action: 'read' | 'update', command: (context: CoManagedSharedWorkContext) => Promise<T>): Promise<T> {
  if (!inputActor || !inputResource) deny();
  // Snapshot qualified identities before the first await; a bulk caller must
  // not be able to change this command by reusing its input object.
  const actor: CoManagedSessionActor = { kind: inputActor.kind, tenant: inputActor.tenant, userId: inputActor.userId, sessionId: inputActor.sessionId };
  const resource: CoManagedSharedResource = { tenant: inputResource.tenant, relationshipId: inputResource.relationshipId, kind: inputResource.kind, id: inputResource.id };
  if (actor.kind !== 'session' || !['read', 'update'].includes(action) ||
      !['ticket', 'project', 'project_task'].includes(resource.kind) || actor.tenant === resource.tenant ||
      ![actor.tenant, actor.userId, actor.sessionId, resource.tenant, resource.relationshipId, resource.id].every(id => uuid.test(id))) deny();
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, resource.tenant), home = tenantDb(trx, actor.tenant);
    const found = await owner.table('co_management_relationships').where({ relationship_id: resource.relationshipId, sponsor_tenant: actor.tenant }).first();
    if (!found) deny();
    await getCoManagedOperationalState(trx, resource.tenant);
    const relationship = await owner.table('co_management_relationships').where({ relationship_id: resource.relationshipId,
      sponsor_tenant: actor.tenant, state: 'active' }).whereNull('ended_at').forShare().first();
    const customerTenant = await owner.table('tenants').first('product_code', 'suspended_at');
    const homeTenant = await home.table('tenants').forShare().first('product_code', 'suspended_at');
    if (!relationship || customerTenant?.product_code !== 'co_managed' || homeTenant?.product_code !== 'psa' ||
        customerTenant.suspended_at || homeTenant.suspended_at) deny();
    const user = await home.table('users').where({ user_id: actor.userId, user_type: 'internal', is_inactive: false }).forShare().first('user_id');
    const session = await home.table('sessions').where({ session_id: actor.sessionId, user_id: actor.userId })
      .whereNull('revoked_at').forShare().first('session_id');
    if (!user || !session) deny();
    const memberships = await home.table('team_members').where('user_id', actor.userId).forShare().select('team_id');
    const teamIds = memberships.map(row => row.team_id);
    const roles = await home.table('user_roles').where('user_id', actor.userId).forShare().select('role_id');
    const staff = await home.table('co_management_staff_assignments')
      .where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId })
      .where(query => query.where({ principal_type: 'user', principal_id: actor.userId })
        .orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', teamIds)))
      .forShare();
    if (!staff.length || (action === 'update' && !staff.some(row => row.relationship_role === 'technician'))) deny();

    let canCollaborate = false;
    if (resource.kind === 'ticket') {
      const ticketQuery = owner.table('tickets').where('ticket_id', resource.id);
      if (action === 'update') ticketQuery.forUpdate(); else ticketQuery.forShare();
      const ticket = await ticketQuery.first('board_id');
      // Explicit escalations will supply their own customer-owned work grant.
      // The presence of a destination board alone grants no ticket visibility.
      if (!ticket || relationship.visibility_mode !== 'board_scope') deny();
      const grant = await owner.table('co_management_board_scopes').where({ relationship_id: resource.relationshipId, board_id: ticket.board_id }).forShare().first();
      if (!grant) deny();
      canCollaborate = grant.can_collaborate;
    } else {
      let projectId = resource.id;
      if (resource.kind === 'project_task') {
        const taskQuery = owner.table('project_tasks').where('project_tasks.task_id', resource.id);
        owner.tenantJoin(taskQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
        const task = await taskQuery.forShare().first('project_phases.project_id');
        if (!task) deny();
        projectId = task.project_id;
      }
      const projectQuery = owner.table('projects').where('project_id', projectId);
      if (action === 'update') projectQuery.forUpdate(); else projectQuery.forShare();
      if (!await projectQuery.first('project_id')) deny();
      const grant = await owner.table('co_management_project_scopes').where({ relationship_id: resource.relationshipId, project_id: projectId }).forShare().first();
      if (!grant) deny();
      canCollaborate = grant.can_collaborate;
    }
    if (action === 'update' && !canCollaborate) deny();

    // This projection contains only home-workspace meanings. In particular a
    // selected-board or own/assigned restriction cannot match a coincidentally
    // equal customer board/user UUID. Future MSP work references can provide
    // those local fields after their qualified source is verified.
    const record: AuthorizationRecord = { id: `${resource.tenant}:${resource.kind}:${resource.id}`,
      clientId: relationship.sponsor_client_id, assignedUserIds: [], teamIds: [] };
    const permissionResource = resource.kind === 'ticket' ? 'ticket' : 'project';
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: input => resolveBundleNarrowingRulesForEvaluation(trx, input, { lock: true }) }),
      rbacEvaluator: () => hasCoManagedLocalPermission(trx, actor, permissionResource, action, true),
    });
    const decision = await kernel.authorizeResource({ knex: trx, subject: { tenant: actor.tenant, userId: actor.userId,
      userType: 'internal', roleIds: roles.map(row => row.role_id), teamIds },
      resource: { type: permissionResource, action, id: record.id }, record });
    if (!decision.allowed || !matchesConstraints(decision.scope.constraints, record)) deny();
    // Recheck wall-clock expiry after any resource/policy lock wait. Session
    // revocation and identity changes wait for this command's retained locks.
    if (!await home.table('sessions').where('session_id', actor.sessionId)
      .where('expires_at', '>', trx.raw('clock_timestamp()')).first('session_id')) deny();
    if (action === 'update') await assertCoManagedOperationalWrite(trx, resource.tenant);
    return command({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, resource: { ...resource },
      action, revision: relationship.revision, redactedFields: decision.redactedFields });
  });
}
