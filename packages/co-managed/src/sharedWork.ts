import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import type { CoManagedHomeActor } from './policy';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, lockCoManagedRecipientIdentity,
  assertCoManagedSessionUnexpired, authorizeCoManagedWorkRecord, type CoManagedSessionActor } from './sharedWorkIdentity';
export { CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';

export interface CoManagedSharedResource {
  tenant: string;
  relationshipId: string;
  kind: 'ticket' | 'project' | 'project_task';
  id: string;
}
export interface CoManagedSharedWorkContext {
  trx: Knex.Transaction;
  actor: CoManagedHomeActor;
  /** Internal verified session identity for commands that wait before writing. */
  sessionId: string;
  resource: CoManagedSharedResource;
  revision: number;
  action: 'read' | 'update';
  /** The command must omit these home-policy fields from its response. */
  redactedFields: readonly string[];
}
function deny(): never { throw new CoManagedSharedWorkError(); }

/** Only trusted delivery adapters construct this server-side recipient identity.
 * It grants no interactive access and cannot be used by mutation commands. */
export interface CoManagedNotificationRecipient extends CoManagedHomeActor { kind: 'notification_recipient' }
export type CoManagedNotificationRecipientContext = Omit<CoManagedSharedWorkContext, 'sessionId' | 'action'> & { action: 'read' };
type SharedPrincipal = CoManagedSessionActor | CoManagedNotificationRecipient;
type SharedPrincipalContext = Omit<CoManagedSharedWorkContext, 'sessionId'>;

/** Session commands retain their existing admission and post-wait session checks. */
export async function withCoManagedSharedWork<T>(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  action: 'read' | 'update', command: (context: CoManagedSharedWorkContext) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withCoManagedSharedPrincipal(db, actor, inputResource, action,
    context => command({ ...context, sessionId: actor.sessionId }));
}

/** Retains each recipient's own current trust, staff assignment, resource grant,
 * and home read policy through delivery. No session is required to receive mail.
 * This resource check alone does not authorize comment bodies or attachments;
 * the delivery adapter must also enforce audience and field redactions. */
export async function withCoManagedNotificationRecipient<T>(db: Knex, input: CoManagedNotificationRecipient, resource: CoManagedSharedResource,
  deliver: (context: CoManagedNotificationRecipientContext) => Promise<T>): Promise<T> {
  if (!input || input.kind !== 'notification_recipient' || ![input.tenant, input.userId].every(isCoManagedUuid)) deny();
  const recipient: CoManagedNotificationRecipient = { kind: 'notification_recipient', tenant: input.tenant, userId: input.userId };
  return withCoManagedSharedPrincipal(db, recipient, resource, 'read', context => deliver({ ...context, action: 'read' }));
}

/** Shared authority engine: qualified home policy projections, retained trust and
 * resource locks, and explicit principal-specific admission. It never changes
 * AsyncLocalStorage/session tenant or grants linked-resource authority. */
async function withCoManagedSharedPrincipal<T>(db: Knex, inputActor: SharedPrincipal, inputResource: CoManagedSharedResource,
  action: 'read' | 'update', command: (context: SharedPrincipalContext) => Promise<T>): Promise<T> {
  if (!inputActor || !inputResource) deny();
  // Snapshot qualified identities before the first await; a bulk caller must
  // not be able to change this command by reusing its input object.
  const actor = inputActor;
  const resource: CoManagedSharedResource = { tenant: inputResource.tenant, relationshipId: inputResource.relationshipId, kind: inputResource.kind, id: inputResource.id };
  if ((actor.kind !== 'session' && (actor.kind !== 'notification_recipient' || action !== 'read')) || !['read', 'update'].includes(action) ||
      !['ticket', 'project', 'project_task'].includes(resource.kind) || actor.tenant === resource.tenant ||
      ![resource.tenant, resource.relationshipId, resource.id].every(isCoManagedUuid)) deny();
  return withTransaction(db, async trx => {
    // LEVERAGE: pattern co-managed-read-admission — detail and federated query paths share trust/session locks but need distinct record projections.
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
    const subject = actor.kind === 'session' ? await lockCoManagedSessionIdentity(trx, actor) : await lockCoManagedRecipientIdentity(trx, actor);
    const teamIds = subject.teamIds ?? [];
    const staff = await home.table('co_management_staff_assignments')
      .where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId })
      .where(query => query.where({ principal_type: 'user', principal_id: actor.userId })
        .orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', teamIds)))
      .forShare();
    if (!staff.length || (action === 'update' && !staff.some(row => row.relationship_role === 'technician'))) deny();

    let canCollaborate = false;
    let workReference: any = null;
    if (resource.kind === 'ticket') {
      const ticketQuery = owner.table('tickets').where('ticket_id', resource.id);
      if (action === 'update') ticketQuery.forUpdate(); else ticketQuery.forShare();
      const ticket = await ticketQuery.first('board_id');
      if (!ticket) deny();
      const work = await owner.table('co_management_ticket_work').where({ relationship_id: resource.relationshipId, ticket_id: resource.id }).forShare().first();
      const explicitGrant = work && !work.grant_revoked_at;
      const boardGrant = relationship.visibility_mode === 'board_scope'
        ? await owner.table('co_management_board_scopes').where({ relationship_id: resource.relationshipId, board_id: ticket.board_id }).forShare().first()
        : null;
      if (!explicitGrant && !boardGrant) deny();
      canCollaborate = Boolean((explicitGrant && work.can_collaborate) || boardGrant?.can_collaborate);
      if (work) {
        workReference = await home.table('co_managed_ticket_references').where({ customer_tenant: resource.tenant,
          relationship_id: resource.relationshipId, ticket_id: resource.id, work_id: work.work_id,
          client_id: relationship.sponsor_client_id }).forShare().first('board_id', 'assigned_to', 'assigned_team_id');
      }
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

    // Customer UUIDs never become home policy IDs. Only a qualified, verified
    // MSP work reference can supply local queue and assignment meanings.
    const record: AuthorizationRecord = { id: `${resource.tenant}:${resource.kind}:${resource.id}`,
      clientId: relationship.sponsor_client_id, boardId: workReference?.board_id,
      assignedUserIds: workReference?.assigned_to ? [workReference.assigned_to] : [],
      teamIds: workReference?.assigned_team_id ? [workReference.assigned_team_id] : [] };
    const permissionResource = resource.kind === 'ticket' ? 'ticket' : 'project';
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, permissionResource, action, record);
    // Recheck wall-clock expiry after any resource/policy lock wait. Session
    // revocation and identity changes wait for this command's retained locks.
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(trx, actor);
    if (action === 'update') await assertCoManagedOperationalWrite(trx, resource.tenant);
    return command({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, resource: { ...resource },
      action, revision: relationship.revision, redactedFields: decision.redactedFields });
  });
}
