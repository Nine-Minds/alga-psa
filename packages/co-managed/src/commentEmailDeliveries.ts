import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { deliverCoManagedTicketCommentToAssignees, isCoManagedNotificationAssignee, type CoManagedTicketCommentDeliveryRequest } from './ticketCommentRecipients';
import { withCoManagedTicketCommentNotification, type CoManagedTicketCommentNotification } from './ticketCommentNotification';
import { coManagedInternalEmailRecipient } from './commentEmailRecipient';
import { withCoManagedTaskCommentNotification, type CoManagedTaskCommentNotification } from './taskCommentNotification';
import { deliverCoManagedTaskCommentToAssignees, isCoManagedTaskNotificationAssignee } from './taskCommentRecipients';
import type { CoManagedNotificationRecipientContext } from './sharedWork';

const TABLE = 'co_management_email_deliveries';
const IDENTITY = ['tenant', 'delivery_key', 'recipient_user_id', 'event_id', 'customer_tenant', 'relationship_id', 'resource_type', 'resource_id', 'ticket_id', 'comment_id', 'thread_id', 'audience'] as const;
export type CoManagedEmailDeliveryResult = { status: 'delivered' | 'skipped' } | { status: 'failed'; errorCode: string; retryable: boolean; retryAfterMs?: number };
export interface CoManagedEmailDelivery {
  tenant: string; recipientUserId: string; email: string; subtypeId?: number; messageId: string; message: CoManagedTicketCommentNotification | CoManagedTaskCommentNotification;
}
/** Persist only qualified routing/source identities, never email addresses,
 * rendered content or provider credentials. Preferences are checked at send. */
export async function enqueueCoManagedCommentEmailDeliveries(db: Knex, request: Omit<CoManagedTicketCommentDeliveryRequest, 'channel'>) {
  const snapshot = { ...request };
  await deliverCoManagedTicketCommentToAssignees(db, { ...snapshot, channel: 'email' },
    (context, message, key) => retainEmailDelivery(context, message, key, snapshot.eventId));
}

/** Both owner and MSP task recipients use the same durable send queue. */
export async function enqueueCoManagedTaskEmailDeliveries(db: Knex, input: { ownerTenant: string; taskId: string; commentId: string; eventId: string }) {
  const request = { ...input };
  await deliverCoManagedTaskCommentToAssignees(db, { ...request, channel: 'email' },
    (context, message, key) => retainEmailDelivery(context, message, key, request.eventId));
}

/** Resource-specific admission feeds one immutable qualified queue identity. */
async function retainEmailDelivery(context: CoManagedNotificationRecipientContext, message: CoManagedEmailDelivery['message'], deliveryKey: string, eventId: string) {
  const home = tenantDb(context.trx, context.actor.tenant);
  const values = { tenant: context.actor.tenant, delivery_key: deliveryKey, recipient_user_id: context.actor.userId, event_id: eventId.toLowerCase(),
    customer_tenant: message.resource.tenant, relationship_id: message.resource.relationshipId, resource_type: message.resource.kind, resource_id: message.resource.id,
    ticket_id: message.resource.kind === 'ticket' ? message.resource.id : null, comment_id: message.commentId, thread_id: message.threadId, audience: message.audience };
  await home.table(TABLE).insert(values).onConflict(['tenant', 'delivery_key']).ignore();
  const row = await home.table(TABLE).where('delivery_key', deliveryKey).forShare().first();
  if (!row || IDENTITY.some(key => row[key] !== values[key])) throw new Error('Co-managed email identity conflict');
}

function sameIdentity(row: any, candidate: any) { return IDENTITY.every(key => row[key] === candidate[key]); }
// LEVERAGE: pattern comment-email-completion — MSP and customer queues retain identical attempt/completion semantics under different source admission.
async function finish(trx: Knex.Transaction, row: any, result: CoManagedEmailDeliveryResult) {
  const attempts = row.attempt_count + 1, retry = result.status === 'failed' && result.retryable && attempts < 10;
  const delay = Math.min(3600000, Math.max(60000 * 2 ** Math.min(attempts - 1, 6), result.status === 'failed' && Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 0));
  await tenantDb(trx, row.tenant).table(TABLE).where('delivery_key', row.delivery_key).update({ status: retry ? 'pending' : result.status,
    attempt_count: attempts, next_attempt_at: retry ? trx.raw("now() + ? * interval '1 millisecond'", [delay]) : null,
    completed_at: retry ? null : trx.raw('now()'), error_code: result.status === 'failed' ? result.errorCode.slice(0, 100) : null });
}
/** Retains current recipient, source and routing locks through the awaited
 * transport. External acceptance followed by a lost commit may repeat a send;
 * its stable RFC Message-ID is preserved, without claiming exactly-once SMTP. */
export async function processCoManagedCommentEmailDeliveries(db: Knex, tenant: string,
  send: (delivery: CoManagedEmailDelivery) => Promise<CoManagedEmailDeliveryResult>, options: { limit?: number } = {}) {
  const limit = options.limit ?? 30;
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid co-managed email recovery scope');
  const due = (trx: Knex, key: string) => tenantDb(trx, tenant).table(TABLE).where({ delivery_key: key, status: 'pending' }).where('next_attempt_at', '<=', trx.raw('clock_timestamp()'));
  const rows = await tenantDb(db, tenant).table(TABLE).where('status', 'pending').where('next_attempt_at', '<=', db.raw('clock_timestamp()')).orderBy('next_attempt_at').orderBy('delivery_key').limit(limit);
  let processed = 0;
  for (const candidate of rows) {
    try {
      const didProcess = await withTransaction(db, async trx => {
        const task = candidate.resource_type === 'project_task';
        if (!task && candidate.resource_type !== 'ticket') throw new Error('Unknown email resource type');
        const resource = { tenant: candidate.customer_tenant, relationshipId: candidate.relationship_id, kind: task ? 'project_task' as const : 'ticket' as const, id: candidate.resource_id };
        const ready = async (context: CoManagedNotificationRecipientContext, message: CoManagedEmailDelivery['message']) => {
          const assigned = await (task ? isCoManagedTaskNotificationAssignee(context) : isCoManagedNotificationAssignee(context)), to = await coManagedInternalEmailRecipient(context, task ? 'Task Comment Added' : 'Ticket Comment Added');
          const row = await due(trx, candidate.delivery_key).forUpdate().skipLocked().first();
          if (!row) return false;
          if (!sameIdentity(row, candidate)) throw new Error('Co-managed email identity changed');
          if (!assigned || !to || message.threadId !== row.thread_id || message.audience !== row.audience) { await finish(trx, row, { status: 'skipped' }); return true; }
          const messageId = `<co-managed-${createHash('sha256').update(row.delivery_key).digest('hex')}@notifications.alga.invalid>`;
          let outcome: CoManagedEmailDeliveryResult;
          try { outcome = await send({ tenant, recipientUserId: context.actor.userId, ...to, messageId, message }); }
          catch { outcome = { status: 'failed', retryable: true, errorCode: 'email_transport_failed' }; }
          if (!outcome || !['delivered', 'skipped', 'failed'].includes(outcome.status)) outcome = { status: 'failed', retryable: true, errorCode: 'invalid_email_transport_result' };
          await finish(trx, row, outcome); return true;
        };
        const delivered = await (task ? withCoManagedTaskCommentNotification : withCoManagedTicketCommentNotification)(trx,
          { kind: 'notification_recipient', tenant, userId: candidate.recipient_user_id }, resource, candidate.comment_id, ready);
        if (delivered !== null) return delivered;
        const row = await due(trx, candidate.delivery_key).forUpdate().skipLocked().first();
        if (!row) return false;
        if (!sameIdentity(row, candidate)) throw new Error('Co-managed email identity changed');
        await finish(trx, row, { status: 'skipped' }); return true;
      });
      if (didProcess) processed++;
    } catch (error) {
      const completed = await withTransaction(db, async trx => {
        const row = await due(trx, candidate.delivery_key).forUpdate().skipLocked().first();
        if (!row || !sameIdentity(row, candidate)) return false;
        await finish(trx, row, error instanceof CoManagedSharedWorkError ? { status: 'skipped' }
          : { status: 'failed', retryable: true, errorCode: 'email_processing_failed' });
        return true;
      });
      if (completed) processed++;
    }
  }
  return { examined: rows.length, processed };
}
