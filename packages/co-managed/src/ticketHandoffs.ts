import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { lockCoManagedCustomerPolicy } from './policy';
import { withCoManagedCustomerTicket } from './customerWork';
import { CoManagedSharedWorkError, isCoManagedUuid, assertCoManagedSessionUnexpired, snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, type CoManagedSessionActor } from './sharedWorkIdentity';

export interface CoManagedTicketHandoffRequest {
  operationId: string;
  /** Zero before the ticket's first escalation; otherwise its current work revision. */
  expectedRevision: number;
  /** Plain text, deliberately shared with authorized technicians in both organizations. */
  note: string;
}
export interface CoManagedTicketHandoffReceipt {
  operationId: string;
  appliedRevision: number;
  transition: 'escalated' | 'handed_back' | 'access_revoked';
  occurredAt: string;
}
export class CoManagedTicketHandoffError extends Error {
  constructor(public readonly code: 'INVALID_HANDOFF' | 'HANDOFF_CHANGED' | 'ALREADY_RESPONSIBLE' | 'ALREADY_REVOKED' | 'DESTINATION_UNAVAILABLE') {
    super({ INVALID_HANDOFF: 'Provide a valid handoff with a shared IT note.',
      HANDOFF_CHANGED: 'This handoff or its work revision changed. Refresh the ticket before trying again.',
      ALREADY_RESPONSIBLE: 'This organization is already responsible for the ticket.',
      ALREADY_REVOKED: 'This explicit ticket grant has already been revoked.',
      DESTINATION_UNAVAILABLE: 'The approved MSP destination is not available.',
    }[code]);
    this.name = 'CoManagedTicketHandoffError';
  }
}
function snapshotRequest(input: CoManagedTicketHandoffRequest): CoManagedTicketHandoffRequest {
  if (!input || !isCoManagedUuid(input.operationId) || !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 || input.expectedRevision >= 2147483647 || typeof input.note !== 'string' ||
      !input.note.trim() || input.note.length > 10000 || input.note.includes('\0')) throw new CoManagedTicketHandoffError('INVALID_HANDOFF');
  return { operationId: input.operationId.toLowerCase(), expectedRevision: input.expectedRevision, note: input.note.trim() };
}
function receipt(row: any): CoManagedTicketHandoffReceipt {
  return { operationId: row.operation_id, appliedRevision: row.revision, transition: row.transition,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at) };
}

async function transitionTicket(context: CoManagedSharedWorkContext, request: CoManagedTicketHandoffRequest,
  transition: CoManagedTicketHandoffReceipt['transition']): Promise<CoManagedTicketHandoffReceipt> {
  const { trx, actor, resource } = context;
  const customer = tenantDb(trx, resource.tenant);
  const relationship = await customer.table('co_management_relationships').where('relationship_id', resource.relationshipId).first();
  if (!relationship || ![resource.tenant, relationship.sponsor_tenant].includes(actor.tenant)) throw new CoManagedSharedWorkError();
  const fingerprint = createHash('sha256').update(JSON.stringify({ actor, resource, transition, request })).digest('hex');
  const prior = await customer.table('co_management_ticket_handoffs').where('operation_id', request.operationId).first();
  if (prior) {
    if (prior.request_fingerprint !== fingerprint) throw new CoManagedTicketHandoffError('HANDOFF_CHANGED');
    // Return the immutable original receipt even after subsequent transitions;
    // callers refresh current work separately instead of treating this as its state.
    return receipt(prior);
  }
  const key = { relationship_id: resource.relationshipId, ticket_id: resource.id };
  const work = await customer.table('co_management_ticket_work').where(key).forUpdate().first();
  if ((work?.revision ?? 0) !== request.expectedRevision) throw new CoManagedTicketHandoffError('HANDOFF_CHANGED');
  const responsibility = transition === 'escalated' ? 'msp' : 'customer';
  if (transition === 'access_revoked') {
    if (!work) throw new CoManagedTicketHandoffError('HANDOFF_CHANGED');
    if (work.grant_revoked_at) throw new CoManagedTicketHandoffError('ALREADY_REVOKED');
  } else if ((work?.responsibility ?? 'customer') === responsibility) throw new CoManagedTicketHandoffError('ALREADY_RESPONSIBLE');
  const sponsor = tenantDb(trx, relationship.sponsor_tenant);
  const referenceKey = { customer_tenant: resource.tenant, ...key };
  const foundReference = await sponsor.table('co_managed_ticket_references').where(referenceKey).forUpdate().first();
  const matchesWork = foundReference?.work_id === work?.work_id && foundReference?.client_id === relationship.sponsor_client_id;
  if (foundReference && !matchesWork && transition !== 'access_revoked') throw new CoManagedTicketHandoffError('HANDOFF_CHANGED');
  // Broken MSP routing must not prevent a customer from revoking its grant.
  const previousReference = matchesWork ? foundReference : null;
  if (transition === 'escalated') {
    // The browser cannot provide an MSP board/client, assignee, priority, or status.
    const board = await sponsor.table('boards').where({ board_id: relationship.escalation_board_id, is_inactive: false }).forShare().first('board_id');
    const client = await sponsor.table('clients').where('client_id', relationship.sponsor_client_id).forShare().first('client_id');
    if (!board || !client) throw new CoManagedTicketHandoffError('DESTINATION_UNAVAILABLE');
  }
  await assertCoManagedSessionUnexpired(trx, { ...actor, kind: 'session', sessionId: context.sessionId });
  // Revocation is a security reduction, available even during a license pause.
  if (transition !== 'access_revoked') await assertCoManagedOperationalWrite(trx, resource.tenant);
  const occurredAt = (await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at;
  const workId = work?.work_id ?? randomUUID();
  const revision = request.expectedRevision + 1;
  if (!work) await customer.table('co_management_ticket_work').insert({ tenant: resource.tenant, ...key, work_id: workId,
    revision, responsibility, can_collaborate: true, first_escalated_at: occurredAt, last_transition_at: occurredAt });
  else await customer.table('co_management_ticket_work').where(key).update({ revision, responsibility, last_transition_at: occurredAt,
    // Re-escalating is a new explicit customer decision to share this ticket.
    ...(transition === 'escalated' ? { grant_revoked_at: null, can_collaborate: true, first_escalated_at: work.first_escalated_at ?? occurredAt } :
      transition === 'access_revoked' ? { grant_revoked_at: occurredAt, can_collaborate: false } : {}) });
  if (!previousReference && transition !== 'access_revoked') {
    if (transition !== 'escalated') throw new CoManagedTicketHandoffError('HANDOFF_CHANGED');
    await sponsor.table('co_managed_ticket_references').insert({ tenant: relationship.sponsor_tenant, ...referenceKey,
      reference_id: randomUUID(), work_id: workId, client_id: relationship.sponsor_client_id, board_id: relationship.escalation_board_id,
      created_at: occurredAt, updated_at: occurredAt });
  } else if (previousReference) await sponsor.table('co_managed_ticket_references').where(referenceKey).update({ updated_at: occurredAt,
    ...(transition === 'escalated' ? { board_id: relationship.escalation_board_id } : { assigned_to: null, assigned_team_id: null }) });
  const home = tenantDb(trx, actor.tenant);
  const author = await home.table('users').where('user_id', actor.userId).first('first_name', 'last_name', 'username');
  const organization = await home.table('tenants').first('client_name');
  const event = { tenant: resource.tenant, ...key, operation_id: request.operationId, revision, transition,
    request_fingerprint: fingerprint, actor_tenant: actor.tenant, actor_user_id: actor.userId,
    actor_name: [author.first_name, author.last_name].filter(Boolean).join(' ').trim() || author.username,
    actor_organization: organization.client_name, note: request.note, audience: 'shared_it', occurred_at: occurredAt };
  await customer.table('co_management_ticket_handoffs').insert(event);
  return receipt(event);
}

/** Immediate responsibility, explicit grant, shared note, and MSP queue reference
 * commit together. No copied ticket, customer-board move, or local status rewrite.
 * Handoff events retain exact timestamps for independent MSP SLA consumers. */
export async function escalateCoManagedTicket(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  input: CoManagedTicketHandoffRequest): Promise<CoManagedTicketHandoffReceipt> {
  const request = snapshotRequest(input);
  return withCoManagedCustomerTicket(db, actor, resource, 'update', context => transitionTicket(context, request, 'escalated'));
}

/** Handback changes responsibility only; it never implicitly removes visibility
 * or resets the original escalation identity/history. */
export async function handBackCoManagedTicket(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  input: CoManagedTicketHandoffRequest): Promise<CoManagedTicketHandoffReceipt> {
  const request = snapshotRequest(input);
  if (!resource || resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
  const command = (context: CoManagedSharedWorkContext) => transitionTicket(context, request, 'handed_back');
  return actor?.tenant === resource.tenant ? withCoManagedCustomerTicket(db, actor, resource, 'update', command)
    : withCoManagedSharedWork(db, actor, resource, 'update', command);
}


/** Only a customer administrator can remove the ticket's explicit grant.
 * Responsibility returns to the customer atomically. Independent board grants
 * still apply; removing this grant is not a deny override for an entire board. */
export async function revokeCoManagedTicketGrant(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedTicketHandoffRequest): Promise<CoManagedTicketHandoffReceipt> {
  const request = snapshotRequest(input), actor = snapshotCoManagedSessionActor(inputActor);
  if (!inputResource || inputResource.kind !== 'ticket' || actor.tenant !== inputResource.tenant ||
      ![inputResource.relationshipId, inputResource.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { tenant: actor.tenant, relationshipId: inputResource.relationshipId, kind: 'ticket', id: inputResource.id };
  return withTransaction(db, async trx => {
    const { customer, relationship } = await lockCoManagedCustomerPolicy(trx, actor, { customerTenant: resource.tenant, relationshipId: resource.relationshipId });
    await lockCoManagedSessionIdentity(trx, actor);
    if ((await customer.table('tenants').first('suspended_at'))?.suspended_at) throw new CoManagedSharedWorkError();
    if (!await customer.table('tickets').where('ticket_id', resource.id).forUpdate().first('ticket_id')) throw new CoManagedSharedWorkError();
    await assertCoManagedSessionUnexpired(trx, actor);
    return transitionTicket({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource,
      revision: relationship.revision, action: 'update', redactedFields: [] }, request, 'access_revoked');
  });
}
