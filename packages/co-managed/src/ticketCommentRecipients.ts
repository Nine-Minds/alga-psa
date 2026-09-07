import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import type { CoManagedNotificationRecipientContext, CoManagedSharedResource } from './sharedWork';
import { withCoManagedTicketCommentNotification, type CoManagedTicketCommentNotification } from './ticketCommentNotification';

export interface CoManagedTicketCommentDeliveryRequest {
  ownerTenant: string;
  ticketId: string;
  commentId: string;
  eventId: string;
  channel: 'email' | 'in_app';
}

async function routingReference(db: Knex, resource: CoManagedSharedResource, sponsorTenant: string, lock = false) {
  const owner = tenantDb(db, resource.tenant);
  const relationship = await owner.table('co_management_relationships').where({ relationship_id: resource.relationshipId,
    sponsor_tenant: sponsorTenant, state: 'active' }).whereNull('ended_at').first('sponsor_client_id');
  if (!relationship) return null;
  const work = await owner.table('co_management_ticket_work').where({ relationship_id: resource.relationshipId, ticket_id: resource.id }).first('work_id');
  if (!work) return null;
  const reference = tenantDb(db, sponsorTenant).table('co_managed_ticket_references').where({ customer_tenant: resource.tenant,
    relationship_id: resource.relationshipId, ticket_id: resource.id, work_id: work.work_id, client_id: relationship.sponsor_client_id });
  if (lock) reference.forShare();
  return await reference.first('assigned_to', 'assigned_team_id');
}

/** Routing is a candidate selector, never permission. Recheck it while the
 * recipient's resource authority is held so a queued event cannot notify an
 * agent removed from the assignment/team between discovery and delivery. */
export async function isCoManagedNotificationAssignee(context: CoManagedNotificationRecipientContext): Promise<boolean> {
  const reference = await routingReference(context.trx, context.resource, context.actor.tenant, true);
  if (!reference) return false;
  if (reference.assigned_to === context.actor.userId) return true;
  if (!reference.assigned_team_id) return false;
  return Boolean(await tenantDb(context.trx, context.actor.tenant).table('team_members')
    .where({ team_id: reference.assigned_team_id, user_id: context.actor.userId }).forShare().first('user_id'));
}

/** Server-side fanout to current MSP routing recipients. Never treats customer
 * assignment/mention UUIDs as MSP users and never notifies all relationship staff.
 * Channel adapters enforce preferences and persist an idempotency receipt using
 * deliveryKey; this coordinator does not claim exactly-once external delivery.
 * Expected access loss skips a candidate, while delivery failures are surfaced
 * after the remaining independent recipients have been attempted. */
export async function deliverCoManagedTicketCommentToAssignees(db: Knex, input: CoManagedTicketCommentDeliveryRequest,
  deliver: (context: CoManagedNotificationRecipientContext, message: CoManagedTicketCommentNotification, deliveryKey: string) => Promise<void>): Promise<void> {
  if (!input || ![input.ownerTenant, input.ticketId, input.commentId, input.eventId].every(isCoManagedUuid) ||
    !['email', 'in_app'].includes(input.channel)) throw new CoManagedSharedWorkError();
  const request = { ownerTenant: input.ownerTenant.toLowerCase(), ticketId: input.ticketId.toLowerCase(), commentId: input.commentId.toLowerCase(), eventId: input.eventId.toLowerCase(), channel: input.channel };
  const owner = tenantDb(db, request.ownerTenant);
  const relationship = await owner.table('co_management_relationships').where('state', 'active').whereNull('ended_at').first('relationship_id', 'sponsor_tenant');
  if (!relationship) return;
  const resource: CoManagedSharedResource = { tenant: request.ownerTenant, relationshipId: relationship.relationship_id, kind: 'ticket', id: request.ticketId };
  const reference = await routingReference(db, resource, relationship.sponsor_tenant);
  if (!reference || (!reference.assigned_to && !reference.assigned_team_id)) return;
  const home = tenantDb(db, relationship.sponsor_tenant);
  const candidates = await home.table('users').where({ user_type: 'internal', is_inactive: false }).where(query => {
    if (reference.assigned_to) query.where('user_id', reference.assigned_to);
    if (reference.assigned_team_id) query.orWhereIn('user_id', home.table('team_members').where('team_id', reference.assigned_team_id).select('user_id'));
  }).orderBy('user_id').select('user_id');
  const failures: unknown[] = [];
  for (const candidate of candidates) {
    try {
      await withCoManagedTicketCommentNotification(db, { kind: 'notification_recipient', tenant: relationship.sponsor_tenant, userId: candidate.user_id },
        resource, request.commentId, async (context, message) => {
          if (!await isCoManagedNotificationAssignee(context)) return;
          const deliveryKey = `co-managed-comment:${request.ownerTenant}:${request.ticketId}:${request.commentId}:${request.eventId}:${request.channel}:${context.actor.tenant}:${context.actor.userId}`;
          await deliver(context, message, deliveryKey);
        });
    } catch (error) {
      if (!(error instanceof CoManagedSharedWorkError)) failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Co-managed comment delivery failed for one or more recipients');
}
