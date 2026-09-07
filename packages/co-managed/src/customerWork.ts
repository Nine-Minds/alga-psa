import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import { snapshotCoManagedSessionActor, isCoManagedUuid, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  authorizeCoManagedWorkRecord, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedSharedResource, CoManagedSharedWorkContext } from './sharedWork';

/** Customer-local ticket authority. The customer must have the requested action on
 * this actual ticket under current RBAC and bundle narrowing; a relationship
 * administrator role alone does not authorize private ticket access. */
export async function withCoManagedCustomerTicket<T>(db: Knex, inputActor: CoManagedSessionActor,
  inputResource: CoManagedSharedResource, action: 'read' | 'update', command: (context: CoManagedSharedWorkContext) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!['read', 'update'].includes(action) || !inputResource || inputResource.kind !== 'ticket' || actor.tenant !== inputResource.tenant ||
      ![inputResource.relationshipId, inputResource.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { tenant: actor.tenant, relationshipId: inputResource.relationshipId, kind: 'ticket', id: inputResource.id };
  return withTransaction(db, async trx => {
    if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant);
    else await getCoManagedOperationalState(trx, actor.tenant);
    const customer = tenantDb(trx, actor.tenant);
    const relationship = await customer.table('co_management_relationships').where({ relationship_id: resource.relationshipId, state: 'active' })
      .whereNull('ended_at').forShare().first();
    const owner = await customer.table('tenants').first('product_code', 'suspended_at');
    if (!relationship || owner?.product_code !== 'co_managed' || owner.suspended_at) throw new CoManagedSharedWorkError();
    const sponsor = await tenantDb(trx, relationship.sponsor_tenant).table('tenants').forShare().first('product_code', 'suspended_at');
    if (sponsor?.product_code !== 'psa' || sponsor.suspended_at) throw new CoManagedSharedWorkError();
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    const ticketQuery = customer.table('tickets').where('ticket_id', resource.id);
    if (action === 'update') ticketQuery.forUpdate(); else ticketQuery.forShare();
    const ticket = await ticketQuery.first('ticket_id', 'client_id', 'board_id', 'entered_by', 'assigned_to', 'assigned_team_id');
    if (!ticket) throw new CoManagedSharedWorkError();
    // Additional time-entry resources do not confer ticket access.
    // LEVERAGE: pattern customer-ticket-policy-record — local commands and recipient reads use the same owner projection with distinct lifecycle admission.
    const record: AuthorizationRecord = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id,
      ownerUserId: ticket.entered_by, assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [],
      teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
    await assertCoManagedSessionUnexpired(trx, actor);
    if (action === 'update') await assertCoManagedOperationalWrite(trx, actor.tenant);
    return command({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, revision: relationship.revision,
      action, redactedFields: decision.redactedFields });
  });
}
