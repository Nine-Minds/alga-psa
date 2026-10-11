import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { withCoManagedNotificationRecipient, withCoManagedSharedWork, type CoManagedNotificationRecipient, type CoManagedNotificationRecipientContext, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { authorizeCoManagedWorkRecord, assertCoManagedSessionUnexpired, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity, lockCoManagedSessionIdentity, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export const CO_MANAGED_ROUTING_EVENTS = 'co_management_ticket_routing_events';
export const CO_MANAGED_ROUTING_RECIPIENTS = 'co_management_ticket_routing_recipients';
export type CoManagedRoutingTransition = 'escalated' | 'handed_back' | 'assigned';
export interface CoManagedTicketRoutingNotification {
  resource: CoManagedSharedResource; eventId: string; transition: CoManagedRoutingTransition;
  ticketNumber?: string; ticketTitle?: string; ownerLocal: boolean;
}

async function routing(db: Knex, tenant: string, event: any, lock = false): Promise<string[]> {
  const owner = tenantDb(db, event.customer_tenant), home = tenantDb(db, tenant);
  const workQuery = owner.table('co_management_ticket_work').where({ relationship_id: event.relationship_id, ticket_id: event.ticket_id });
  if (lock) workQuery.forShare();
  const work = await workQuery.first();
  if (!work || work.revision !== event.work_revision || (event.transition !== 'assigned' && work.responsibility !== (event.transition === 'escalated' ? 'msp' : 'customer'))) return [];
  let reference: any;
  if (tenant === event.customer_tenant) {
    const query = owner.table('tickets').where('ticket_id', event.ticket_id); if (lock) query.forShare();
    reference = await query.first('assigned_to', 'assigned_team_id', 'board_id');
  } else {
    const relation = await owner.table('co_management_relationships').where({ relationship_id: event.relationship_id, sponsor_tenant: tenant, state: 'active' }).whereNull('ended_at').first();
    if (!relation) return [];
    const query = home.table('co_managed_ticket_references').where({ customer_tenant: event.customer_tenant, relationship_id: event.relationship_id,
      ticket_id: event.ticket_id, work_id: work.work_id, client_id: relation.sponsor_client_id });
    if (lock) query.forShare(); reference = await query.first('assigned_to', 'assigned_team_id', 'board_id');
  }
  if (!reference) return [];
  const ids = new Set<string>();
  if (reference.assigned_to) ids.add(reference.assigned_to);
  if (reference.assigned_team_id) {
    const query = home.table('team_members').where('team_id', reference.assigned_team_id); if (lock) query.forShare();
    for (const row of await query.select('user_id')) ids.add(row.user_id);
  }
  // An unassigned handoff arrives at the approved board's manager. Assignment
  // notices never expand to unrelated staff or another organization's user IDs.
  if (!ids.size && event.transition !== 'assigned') {
    const query = home.table('boards').where({ board_id: reference.board_id, is_inactive: false }); if (lock) query.forShare();
    const board = await query.first('manager_user_id'); if (board?.manager_user_id) ids.add(board.manager_user_id);
  }
  return [...ids].filter(id => event.actor_tenant !== tenant || event.actor_user_id !== id).sort();
}

/** Persist candidate obligations beside the canonical routing mutation. No
 * external send or cached ticket content enters the command transaction. */
export async function retainCoManagedTicketRoutingNotification(context: CoManagedSharedWorkContext, eventId: string,
  transition: CoManagedRoutingTransition, revision: number): Promise<void> {
  const { trx, actor, resource } = context;
  if (!trx.isTransaction || !isCoManagedUuid(eventId) || !['escalated', 'handed_back', 'assigned'].includes(transition)) throw new CoManagedSharedWorkError();
  const relation = await tenantDb(trx, resource.tenant).table('co_management_relationships').where('relationship_id', resource.relationshipId).first('sponsor_tenant');
  if (!relation) throw new CoManagedSharedWorkError();
  const tenant = transition === 'handed_back' ? resource.tenant : relation.sponsor_tenant;
  const event = { tenant, event_id: eventId, customer_tenant: resource.tenant, relationship_id: resource.relationshipId, ticket_id: resource.id,
    actor_tenant: actor.tenant, actor_user_id: actor.userId, work_revision: revision, transition };
  const home = tenantDb(trx, tenant);
  await home.table(CO_MANAGED_ROUTING_EVENTS).insert(event);
  const ids = await routing(trx, tenant, event);
  const users = ids.length ? await home.table('users').whereIn('user_id', ids).where({ user_type: 'internal', is_inactive: false }).select('user_id') : [];
  if (users.length) await home.table(CO_MANAGED_ROUTING_RECIPIENTS).insert(users.flatMap(user => ['in_app', 'email'].map(channel => ({
    tenant, event_id: eventId, recipient_user_id: user.user_id, channel,
  }))));
  // Fanout is complete once its recipient obligations are durable; each channel
  // records delivery independently, including events with no eligible candidate.
  await home.table(CO_MANAGED_ROUTING_EVENTS).where('event_id', eventId).update({ status: 'completed', completed_at: trx.raw('now()') });
}

/** Owner reads retain their native ticket policy after departure. Foreign reads
 * use the same trust/staff/grant boundary as shared ticket detail. */
async function withRoutingAuthority<T>(db: Knex, actor: CoManagedSessionActor | CoManagedNotificationRecipient, resource: CoManagedSharedResource,
  read: (context: CoManagedNotificationRecipientContext) => Promise<T>): Promise<T> {
  if (actor.tenant !== resource.tenant) return actor.kind === 'session'
    ? withCoManagedSharedWork(db, actor, resource, 'read', read) : withCoManagedNotificationRecipient(db, actor, resource, read);
  return withTransaction(db, async trx => {
    const home = tenantDb(trx, actor.tenant), workspace = await home.table('tenants').forShare().first('product_code', 'suspended_at');
    if (!workspace || !['co_managed', 'psa'].includes(workspace.product_code) || workspace.suspended_at) throw new CoManagedSharedWorkError();
    const subject = actor.kind === 'session' ? await lockCoManagedSessionIdentity(trx, actor) : await lockCoManagedRecipientIdentity(trx, actor);
    const ticket = await home.table('tickets').where('ticket_id', resource.id).forShare().first(); if (!ticket) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern customer-ticket-policy-record — recipient routing and local ticket commands use the same owner projection.
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', 'read', { id: ticket.ticket_id, clientId: ticket.client_id,
      boardId: ticket.board_id, ownerUserId: ticket.entered_by, assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] });
    return read({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, resource, revision: 0, action: 'read', redactedFields: decision.redactedFields });
  });
}

export async function withCoManagedTicketRoutingNotification<T>(db: Knex, input: CoManagedSessionActor | CoManagedNotificationRecipient,
  eventId: string, channel: 'in_app' | 'email', consume: (context: CoManagedNotificationRecipientContext, message: CoManagedTicketRoutingNotification) => Promise<T>): Promise<T | null> {
  if (!input || !['session', 'notification_recipient'].includes(input.kind) || ![input.tenant, input.userId, eventId].every(isCoManagedUuid) || !['in_app', 'email'].includes(channel)) throw new CoManagedSharedWorkError();
  const actor = input.kind === 'session' ? snapshotCoManagedSessionActor(input) : { kind: 'notification_recipient' as const, tenant: input.tenant.toLowerCase(), userId: input.userId.toLowerCase() };
  eventId = eventId.toLowerCase();
  const home = tenantDb(db, actor.tenant), event = await home.table(CO_MANAGED_ROUTING_EVENTS).where('event_id', eventId).first();
  if (!event || !await home.table(CO_MANAGED_ROUTING_RECIPIENTS).where({ event_id: eventId, recipient_user_id: actor.userId, channel }).first()) return null;
  const resource: CoManagedSharedResource = { tenant: event.customer_tenant, relationshipId: event.relationship_id, kind: 'ticket', id: event.ticket_id };
  try { return await withRoutingAuthority(db, actor, resource, async context => {
    const hidden = (fields: string[]) => isCoManagedReadFieldHidden(context.redactedFields, fields.flatMap(field => [field, `values.${field}`, `tickets.${field}`]));
    if (hidden(['work', 'co_management_ticket_work', 'co_management_ticket_handoffs', 'responsibility', 'mspAssignment', 'msp_assignment', 'assigned_to', 'assigned_team_id'])) return null;
    const current = await tenantDb(context.trx, actor.tenant).table(CO_MANAGED_ROUTING_EVENTS).where('event_id', eventId).forShare().first();
    if (!current || ['customer_tenant', 'relationship_id', 'ticket_id', 'transition', 'work_revision', 'actor_tenant', 'actor_user_id'].some(key => current[key] !== event[key])) return null;
    if (actor.kind === 'notification_recipient' && !(await routing(context.trx, actor.tenant, current, true)).includes(actor.userId)) return null;
    const ticket = await tenantDb(context.trx, resource.tenant).table('tickets').where('ticket_id', resource.id).forShare().first('title', 'ticket_number');
    if (!ticket) return null;
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
    const result = await consume(context, { resource, eventId, transition: current.transition, ownerLocal: actor.tenant === resource.tenant,
      ...(hidden(['ticket_number']) ? {} : { ticketNumber: ticket.ticket_number }), ...(hidden(['title']) ? {} : { ticketTitle: ticket.title }) });
    if (actor.kind === 'session') await assertCoManagedSessionUnexpired(context.trx, actor);
    return result;
  }); } catch (error) { if (error instanceof CoManagedSharedWorkError) return null; throw error; }
}

export async function withCoManagedStoredRoutingNotification<T>(db: Knex, actor: CoManagedSessionActor | CoManagedNotificationRecipient,
  notificationId: string, consume: (message: CoManagedTicketRoutingNotification, templateName: string, languageCode: string) => Promise<T>,
  options: { notificationLock?: 'share' | 'update' } = {}): Promise<T | null> {
  if (!isCoManagedUuid(notificationId) || !['share', 'update'].includes(options.notificationLock ?? 'share')) throw new CoManagedSharedWorkError();
  const home = tenantDb(db, actor.tenant), receipt = await home.table(CO_MANAGED_ROUTING_RECIPIENTS).where({ notification_id: notificationId, recipient_user_id: actor.userId, channel: 'in_app', status: 'created' }).first();
  if (!receipt) return null;
  return withCoManagedTicketRoutingNotification(db, actor, receipt.event_id, 'in_app', async (context, message) => {
    const local = tenantDb(context.trx, actor.tenant);
    if (!await local.table(CO_MANAGED_ROUTING_RECIPIENTS).where({ event_id: message.eventId, recipient_user_id: actor.userId, channel: 'in_app', status: 'created', notification_id: notificationId }).forShare().first()) return null;
    const query = local.table('internal_notifications').where({ internal_notification_id: notificationId, user_id: actor.userId }).whereNull('deleted_at');
    if (options.notificationLock === 'update') query.forUpdate(); else query.forShare();
    const row = await query.first('template_name', 'language_code', 'metadata'), marker = row?.metadata?.coManaged;
    if (!marker || marker.version !== 4 || marker.kind !== 'ticket_routing' || marker.eventId !== message.eventId || marker.transition !== message.transition ||
      marker.resource?.tenant !== message.resource.tenant || marker.resource?.relationshipId !== message.resource.relationshipId || marker.resource?.kind !== 'ticket' ||
      marker.resource?.id !== message.resource.id || row.template_name !== `co-managed-ticket-${message.transition}`) return null;
    return consume(message, row.template_name, row.language_code);
  });
}
