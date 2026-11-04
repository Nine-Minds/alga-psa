import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing/lifecycle';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import { snapshotCoManagedSessionActor, isCoManagedUuid, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  authorizeCoManagedWorkRecord, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedSharedResource, CoManagedSharedWorkContext } from './sharedWork';

/** Customer-local resource authority. Current RBAC and bundle policy use the
 * actual customer ticket or parent project; relationship administration alone
 * does not grant access to private operational records. */
async function withCoManagedCustomerWork<T>(db: Knex, inputActor: CoManagedSessionActor,
  inputResource: CoManagedSharedResource, action: 'read' | 'update', command: (context: CoManagedSharedWorkContext) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!['read', 'update'].includes(action) || !inputResource || !['ticket', 'project', 'project_task'].includes(inputResource.kind) || actor.tenant !== inputResource.tenant ||
      ![inputResource.relationshipId, inputResource.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { tenant: actor.tenant, relationshipId: inputResource.relationshipId, kind: inputResource.kind, id: inputResource.id };
  return withTransaction(db, async trx => {
    if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant);
    else await getCoManagedOperationalState(trx, actor.tenant);
    const customer = tenantDb(trx, actor.tenant);
    // Reads survive relationship termination: the customer keeps read access to
    // its own operational records after departure, so a read only needs the
    // relationship row for identity. Updates still require live, unended trust.
    const relationshipQuery = customer.table('co_management_relationships').where({ relationship_id: resource.relationshipId });
    if (action === 'update') relationshipQuery.where({ state: 'active' }).whereNull('ended_at');
    const relationship = await relationshipQuery.forShare().first();
    const owner = await customer.table('tenants').first('product_code', 'suspended_at');
    if (!relationship || owner?.product_code !== 'co_managed' || owner.suspended_at) throw new CoManagedSharedWorkError();
    // Sponsor lifecycle admission only guards live collaboration. A retained
    // customer read after the relationship ended is purely customer-local and
    // must not depend on the former sponsor's continued product state.
    if (action === 'update' || (relationship.state === 'active' && !relationship.ended_at)) {
      const sponsor = await tenantDb(trx, relationship.sponsor_tenant).table('tenants').forShare().first('product_code', 'suspended_at');
      if (sponsor?.product_code !== 'psa' || sponsor.suspended_at) throw new CoManagedSharedWorkError();
    }
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    let record: AuthorizationRecord;
    if (resource.kind === 'ticket') {
      const ticketQuery = customer.table('tickets').where('ticket_id', resource.id);
      if (action === 'update') ticketQuery.forUpdate(); else ticketQuery.forShare();
      const ticket = await ticketQuery.first('ticket_id', 'client_id', 'board_id', 'entered_by', 'assigned_to', 'assigned_team_id');
      if (!ticket) throw new CoManagedSharedWorkError();
      // Additional time-entry resources do not confer ticket access.
      // LEVERAGE: pattern customer-ticket-policy-record — local commands and recipient reads use the same owner projection with distinct lifecycle admission.
      record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id,
        ownerUserId: ticket.entered_by, assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [],
        teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
    } else {
      let projectId = resource.id;
      if (resource.kind === 'project_task') {
        const query = customer.table('project_tasks as task').where('task.task_id', resource.id);
        customer.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
        const task = await query.first('phase.project_id');
        if (!task) throw new CoManagedSharedWorkError();
        projectId = task.project_id;
      }
      const query = customer.table('projects').where('project_id', projectId);
      if (action === 'update') query.forUpdate(); else query.forShare();
      const project = await query.first('project_id', 'client_id', 'assigned_to');
      if (!project) throw new CoManagedSharedWorkError();
      if (resource.kind === 'project_task') {
        const taskQuery = customer.table('project_tasks as task').where('task.task_id', resource.id);
        customer.tenantJoin(taskQuery, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
        if (action === 'update') taskQuery.forUpdate('task', 'phase'); else taskQuery.forShare('task', 'phase');
        if ((await taskQuery.first('phase.project_id'))?.project_id !== projectId) throw new CoManagedSharedWorkError();
      }
      // LEVERAGE: pattern customer-project-policy-record — native task entry points and qualified customer work use the same actual parent project.
      record = { id: project.project_id, clientId: project.client_id, assignedUserIds: project.assigned_to ? [project.assigned_to] : [], teamIds: [] };
    }
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, resource.kind === 'ticket' ? 'ticket' : 'project', action, record);
    await assertCoManagedSessionUnexpired(trx, actor);
    if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant);
    return command({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, revision: relationship.revision,
      action, redactedFields: decision.redactedFields });
  });
}

/** Preserve the ticket-only public contract for existing callers. */
export async function withCoManagedCustomerTicket<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  action: 'read' | 'update', command: (context: CoManagedSharedWorkContext) => Promise<T>): Promise<T> {
  if (resource?.kind !== 'ticket') throw new CoManagedSharedWorkError();
  return withCoManagedCustomerWork(db, actor, resource, action, command);
}

export async function withCoManagedCustomerProject<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  action: 'read' | 'update', command: (context: CoManagedSharedWorkContext) => Promise<T>): Promise<T> {
  if (!resource || !['project', 'project_task'].includes(resource.kind)) throw new CoManagedSharedWorkError();
  return withCoManagedCustomerWork(db, actor, resource, action, command);
}
