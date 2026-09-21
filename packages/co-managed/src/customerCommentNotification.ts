import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import type { CoManagedNotificationRecipient } from './sharedWork';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { readLockedTicketCommentNotification, type TicketCommentNotificationContent } from './ticketCommentNotificationContent';

export interface CoManagedCustomerTicketResource { tenant: string; kind: 'ticket'; id: string }
export interface CoManagedCustomerNotificationContext {
  trx: Knex.Transaction;
  actor: { tenant: string; userId: string };
  resource: CoManagedCustomerTicketResource;
  action: 'read';
  redactedFields: readonly string[];
}
export type CoManagedCustomerCommentNotification = TicketCommentNotificationContent<CoManagedCustomerTicketResource>;

/** Customer technicians read their own retained content using their own current
 * RBAC and bundle policy. No MSP trust, session impersonation, or write/license
 * admission is involved. Recipient routing/preferences remain the adapter's
 * responsibility; this boundary alone does not authorize sending email.
 *
 * Owner-private threads are customer-owned. MSP-private storage is never read.
 * Departure and a paid PSA upgrade do not invalidate ownership-based reads. */
export async function withCoManagedCustomerCommentNotification<T>(db: Knex, input: CoManagedNotificationRecipient,
  inputResource: CoManagedCustomerTicketResource, commentId: string,
  deliver: (context: CoManagedCustomerNotificationContext, message: CoManagedCustomerCommentNotification) => Promise<T>): Promise<T | null> {
  if (!input || input.kind !== 'notification_recipient' || !inputResource || inputResource.kind !== 'ticket' ||
      input.tenant !== inputResource.tenant || ![input.tenant, input.userId, inputResource.id, commentId].every(isCoManagedUuid)) {
    throw new CoManagedSharedWorkError();
  }
  const actor = { tenant: input.tenant, userId: input.userId };
  const resource: CoManagedCustomerTicketResource = { tenant: inputResource.tenant, kind: 'ticket', id: inputResource.id };
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, resource.tenant);
    const tenant = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    if (!tenant || !['co_managed', 'psa'].includes(tenant.product_code) || tenant.suspended_at) throw new CoManagedSharedWorkError();
    const subject = await lockCoManagedRecipientIdentity(trx, actor);
    const ticket = await owner.table('tickets').where('ticket_id', resource.id).forShare()
      .first('ticket_id', 'client_id', 'board_id', 'entered_by', 'assigned_to', 'assigned_team_id');
    if (!ticket) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern customer-ticket-policy-record — local commands and recipient reads use the same owner projection with distinct lifecycle admission.
    const record: AuthorizationRecord = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id,
      ownerUserId: ticket.entered_by, assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [],
      teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', 'read', record);
    const context: CoManagedCustomerNotificationContext = { trx, actor, resource, action: 'read', redactedFields: decision.redactedFields };
    const message = await readLockedTicketCommentNotification(context, commentId, ['requester', 'shared_it', 'organization_private']);
    return message ? deliver(context, message) : null;
  });
}
