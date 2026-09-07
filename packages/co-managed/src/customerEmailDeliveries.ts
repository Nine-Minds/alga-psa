import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { withCoManagedCustomerCommentNotification, type CoManagedCustomerCommentNotification, type CoManagedCustomerNotificationContext } from './customerCommentNotification';
import type { CoManagedEmailDeliveryResult } from './commentEmailDeliveries';
import { coManagedInternalEmailRecipient } from './commentEmailRecipient';
import { issueCoManagedCustomerReplyToken } from './customerReplyTokens';

const TABLE = 'co_management_customer_email_deliveries';
const IDENTITY = ['tenant', 'delivery_key', 'recipient_user_id', 'event_id', 'ticket_id', 'comment_id', 'thread_id', 'audience'] as const;
export interface CoManagedCustomerEmailDelivery {
  tenant: string; recipientUserId: string; email: string; subtypeId?: number; messageId: string; replyToken: string; message: CoManagedCustomerCommentNotification;
}
/** Persist only qualified routing/source identities, never email addresses,
 * rendered content or provider credentials. Preferences are checked at send. */
export interface CoManagedCustomerEmailRequest { ownerTenant: string; ticketId: string; commentId: string; eventId: string }
export async function enqueueCoManagedCustomerEmailDeliveries(db: Knex, input: CoManagedCustomerEmailRequest) {
  if (!input || ![input.ownerTenant, input.ticketId, input.commentId, input.eventId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const request = { ...input };
  const owner = tenantDb(db, request.ownerTenant);
  const ticket = await owner.table('tickets').where('ticket_id', request.ticketId).first('assigned_to', 'assigned_team_id');
  if (!ticket) return;
  const resources = await owner.table('ticket_resources').where('ticket_id', request.ticketId).select('additional_user_id');
  const team = ticket.assigned_team_id ? await owner.table('team_members').where('team_id', ticket.assigned_team_id).select('user_id') : [];
  const ids = [...new Set([ticket.assigned_to, ...resources.map(row => row.additional_user_id), ...team.map(row => row.user_id)].filter(isCoManagedUuid))].sort();
  for (const userId of ids) {
    try {
      await withCoManagedCustomerCommentNotification(db, { kind: 'notification_recipient', tenant: request.ownerTenant, userId },
        { tenant: request.ownerTenant, kind: 'ticket', id: request.ticketId }, request.commentId, async (context, message) => {
          if (!await isCustomerNotificationAssignee(context) || !await commentEmailEnabled(context, message.commentId)) return;
          const home = tenantDb(context.trx, context.actor.tenant);
          const deliveryKey = `co-managed-customer-comment:${request.ownerTenant}:${request.ticketId}:${request.commentId}:${request.eventId.toLowerCase()}:email:${userId}`;
          const values = { tenant: request.ownerTenant, delivery_key: deliveryKey, recipient_user_id: userId, event_id: request.eventId.toLowerCase(),
            ticket_id: message.resource.id, comment_id: message.commentId, thread_id: message.threadId, audience: message.audience };
          await home.table(TABLE).insert(values).onConflict(['tenant', 'delivery_key']).ignore();
          const row = await home.table(TABLE).where('delivery_key', deliveryKey).forShare().first();
          if (!row || IDENTITY.some(key => row[key] !== values[key])) throw new Error('Customer email identity conflict');
        });
    } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
  }
}

async function isCustomerNotificationAssignee(context: CoManagedCustomerNotificationContext): Promise<boolean> {
  const owner = tenantDb(context.trx, context.resource.tenant);
  const ticket = await owner.table('tickets').where('ticket_id', context.resource.id).forShare().first('assigned_to', 'assigned_team_id');
  if (!ticket) return false;
  if (ticket.assigned_to === context.actor.userId) return true;
  if (await owner.table('ticket_resources').where({ ticket_id: context.resource.id, additional_user_id: context.actor.userId }).forShare().first()) return true;
  return Boolean(ticket.assigned_team_id && await owner.table('team_members').where({ team_id: ticket.assigned_team_id, user_id: context.actor.userId }).forShare().first());
}

async function commentEmailEnabled(context: CoManagedCustomerNotificationContext, commentId: string): Promise<boolean> {
  const comment = await tenantDb(context.trx, context.resource.tenant).table('comments').where('comment_id', commentId).first('metadata');
  return Boolean(comment && comment.metadata?.closes_ticket !== true);
}

function sameIdentity(row: any, candidate: any) { return IDENTITY.every(key => row[key] === candidate[key]); }
// LEVERAGE: pattern comment-email-completion — MSP and customer queues retain identical attempt/completion semantics under different source admission.
async function finish(trx: Knex.Transaction, row: any, result: CoManagedEmailDeliveryResult) {
  const attempts = row.attempt_count + 1, retry = result.status === 'failed' && result.retryable && attempts < 10;
  const delay = Math.min(3600000, Math.max(60000 * 2 ** Math.min(attempts - 1, 6), result.status === 'failed' && Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 0));
  await tenantDb(trx, row.tenant).table(TABLE).where('delivery_key', row.delivery_key).update({ status: retry ? 'pending' : result.status,
    attempt_count: attempts, next_attempt_at: retry ? trx.raw("clock_timestamp() + ? * interval '1 millisecond'", [delay]) : null,
    completed_at: retry ? null : trx.raw('clock_timestamp()'), error_code: result.status === 'failed' ? result.errorCode.slice(0, 100) : null });
}
/** Token preparation commits before SMTP can expose the credential. Delivery
 * then reacquires the current recipient, source, preferences and queue locks.
 * External acceptance followed by a lost commit may repeat a send with its stable
 * RFC Message-ID/token; this does not claim exactly-once SMTP delivery. */
export async function processCoManagedCustomerEmailDeliveries(db: Knex, tenant: string,
  send: (delivery: CoManagedCustomerEmailDelivery) => Promise<CoManagedEmailDeliveryResult>, options: { limit?: number } = {}) {
  const limit = options.limit ?? 30;
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid customer email recovery scope');
  const due = (trx: Knex, key: string) => tenantDb(trx, tenant).table(TABLE).where({ delivery_key: key, status: 'pending' }).where('next_attempt_at', '<=', trx.raw('clock_timestamp()'));
  const rows = await tenantDb(db, tenant).table(TABLE).where('status', 'pending').where('next_attempt_at', '<=', db.raw('clock_timestamp()')).orderBy('next_attempt_at').orderBy('delivery_key').limit(limit);
  async function claim(trx: Knex.Transaction, candidate: any) {
    const row = await due(trx, candidate.delivery_key).forUpdate().skipLocked().first();
    if (row && !sameIdentity(row, candidate)) throw new Error('Customer email identity changed');
    return row;
  }
  async function complete(trx: Knex.Transaction, candidate: any, outcome: CoManagedEmailDeliveryResult) {
    const row = await claim(trx, candidate);
    if (!row) return false;
    await finish(trx, row, outcome); return true;
  }
  async function withCurrentDelivery<T>(trx: Knex.Transaction, candidate: any,
    ready: (context: CoManagedCustomerNotificationContext, message: CoManagedCustomerCommentNotification, row: any,
      to: NonNullable<Awaited<ReturnType<typeof coManagedInternalEmailRecipient>>>) => Promise<T>) {
    const resource = { tenant, kind: 'ticket' as const, id: candidate.ticket_id };
    const result = await withCoManagedCustomerCommentNotification(trx, { kind: 'notification_recipient', tenant, userId: candidate.recipient_user_id }, resource, candidate.comment_id, async (context, message) => {
      const assigned = await isCustomerNotificationAssignee(context), to = await coManagedInternalEmailRecipient(context);
      const row = await claim(trx, candidate);
      if (!row) return { kind: 'done' as const, processed: false };
      if (!assigned || !to || !await commentEmailEnabled(context, message.commentId) || message.threadId !== row.thread_id || message.audience !== row.audience) {
        await finish(trx, row, { status: 'skipped' }); return { kind: 'done' as const, processed: true };
      }
      return ready(context, message, row, to);
    });
    return result ?? { kind: 'done' as const, processed: await complete(trx, candidate, { status: 'skipped' }) };
  }
  let processed = 0;
  for (const candidate of rows) {
    try {
      // LEVERAGE: pattern qualified-email-preparation — requester and technician credentials need a committed prepare phase before retained-authority delivery.
      const prepared = await withTransaction(db, trx => withCurrentDelivery(trx, candidate, async (context, message, row) => {
        const issued = await issueCoManagedCustomerReplyToken(trx, { recipient: { kind: 'notification_recipient', ...context.actor },
          resource: context.resource, commentId: message.commentId, deliveryKey: row.delivery_key });
        if (!issued) { await finish(trx, row, { status: 'skipped' }); return { kind: 'done' as const, processed: true }; }
        return { kind: 'ready' as const, ...issued };
      }));
      if (prepared.kind === 'done') { if (prepared.processed) processed++; continue; }
      const delivered = await withTransaction(db, trx => withCurrentDelivery(trx, candidate, async (context, message, row, to) => {
        if (to.email.trim().toLowerCase() !== prepared.email) {
          await finish(trx, row, { status: 'failed', retryable: true, errorCode: 'customer_address_changed' }); return { kind: 'done' as const, processed: true };
        }
        const tokens = tenantDb(trx, tenant).table('co_management_customer_reply_tokens');
        const token = await tokens.where({ token: prepared.token, delivery_key: row.delivery_key, recipient_user_id: context.actor.userId,
          recipient_email: prepared.email, ticket_id: row.ticket_id, comment_id: row.comment_id, thread_id: row.thread_id, audience: row.audience })
          .whereNull('revoked_at').where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()'))).forShare().first('token');
        // A lock wait can outlast the pre-lock expiry predicate.
        const stillActive = token && await tenantDb(trx, tenant).table('co_management_customer_reply_tokens').where('token', token.token)
          .whereNull('revoked_at').where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()'))).first('token');
        if (!stillActive) { await finish(trx, row, { status: 'skipped' }); return { kind: 'done' as const, processed: true }; }
        const messageId = `<co-managed-customer-${createHash('sha256').update(row.delivery_key).digest('hex')}@notifications.alga.invalid>`;
        let outcome: CoManagedEmailDeliveryResult;
        try { outcome = await send({ tenant, recipientUserId: context.actor.userId, ...to, messageId, replyToken: token.token, message }); }
        catch { outcome = { status: 'failed', retryable: true, errorCode: 'email_transport_failed' }; }
        if (!outcome || !['delivered', 'skipped', 'failed'].includes(outcome.status)) outcome = { status: 'failed', retryable: true, errorCode: 'invalid_email_transport_result' };
        await finish(trx, row, outcome); return { kind: 'done' as const, processed: true };
      }));
      if (delivered.processed) processed++;
    } catch (error) {
      await withTransaction(db, trx => complete(trx, candidate, error instanceof CoManagedSharedWorkError ? { status: 'skipped' }
        : { status: 'failed', retryable: true, errorCode: 'email_processing_failed' }));
    }
  }
  return { examined: rows.length, processed };
}
