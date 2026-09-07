import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { discoverCoManagedRequesterCommentEmail, withCoManagedRequesterCommentEmail, type CoManagedRequesterEmailRecipient, type CoManagedRequesterCommentEmail } from './requesterCommentEmail';
import { issueCoManagedRequesterReplyToken } from './requesterReplyTokens';
import { coManagedCommentEmailSettings } from './commentEmailRecipient';
import type { CoManagedEmailDeliveryResult } from './commentEmailDeliveries';

const TABLE = 'co_management_requester_email_deliveries';
const SOURCE = ['tenant', 'delivery_key', 'event_id', 'ticket_id', 'comment_id'] as const;
const IDENTITY = [...SOURCE, 'recipient_kind', 'client_id', 'recipient_id', 'thread_id'] as const;
const normalize = (email: string) => email.trim().toLowerCase();
export interface CoManagedRequesterEmailDelivery {
  tenant: string; recipient: CoManagedRequesterEmailRecipient; email: string; subtypeId?: number;
  messageId: string; replyToken: string; message: CoManagedRequesterCommentEmail;
}
export interface CoManagedRequesterEmailRequest { ownerTenant: string; ticketId: string; commentId: string; eventId: string }
/** The first discovery owns the recipient identity for this event. Replay does
 * not retarget an existing delivery when a ticket's requester changes. */
export async function enqueueCoManagedRequesterEmailDelivery(db: Knex, input: CoManagedRequesterEmailRequest) {
  if (!input || ![input.ownerTenant, input.ticketId, input.commentId, input.eventId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const request = { ...input };
  const source = { tenant: request.ownerTenant, event_id: request.eventId.toLowerCase(), ticket_id: request.ticketId, comment_id: request.commentId,
    delivery_key: `co-managed-requester-comment:${request.ownerTenant}:${request.ticketId}:${request.commentId}:${request.eventId.toLowerCase()}:email` };
  await withTransaction(db, async trx => {
    const owner = tenantDb(trx, source.tenant);
    const existing = await owner.table(TABLE).where('delivery_key', source.delivery_key).first();
    if (existing) { assertSource(existing); return; }
    await discoverCoManagedRequesterCommentEmail(trx, { tenant: source.tenant, kind: 'ticket', id: source.ticket_id }, source.comment_id, async (context, message) => {
      const { recipient } = context;
      await owner.table(TABLE).insert({ ...source, recipient_kind: recipient.kind, client_id: recipient.clientId,
        recipient_id: recipient.kind === 'requester_contact' ? recipient.contactId : recipient.locationId, thread_id: message.threadId })
        .onConflict(['tenant', 'delivery_key']).ignore();
      // A concurrent discovery may already have selected a different requester.
      // Preserve that first selection, rather than replacing it with our snapshot.
      assertSource(await owner.table(TABLE).where('delivery_key', source.delivery_key).forShare().first());
    });
  });
  function assertSource(row: any) { if (!row || SOURCE.some(key => row[key] !== source[key])) throw new Error('Requester email source identity conflict'); }
}
function recipientOf(row: any): CoManagedRequesterEmailRecipient {
  if (row.recipient_kind === 'requester_contact') return { kind: row.recipient_kind, tenant: row.tenant, clientId: row.client_id, contactId: row.recipient_id };
  if (row.recipient_kind === 'requester_location') return { kind: row.recipient_kind, tenant: row.tenant, clientId: row.client_id, locationId: row.recipient_id };
  throw new CoManagedSharedWorkError();
}
function sameIdentity(row: any, candidate: any) { return IDENTITY.every(key => row[key] === candidate[key]); }
// LEVERAGE: pattern comment-email-completion — requester preparation needs a committed token before the otherwise shared attempt/completion protocol.
async function finish(trx: Knex.Transaction, row: any, result: CoManagedEmailDeliveryResult) {
  const attempts = row.attempt_count + 1, retry = result.status === 'failed' && result.retryable && attempts < 10;
  const delay = Math.min(3600000, Math.max(60000 * 2 ** Math.min(attempts - 1, 6), result.status === 'failed' && Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 0));
  await tenantDb(trx, row.tenant).table(TABLE).where('delivery_key', row.delivery_key).update({ status: retry ? 'pending' : result.status,
    attempt_count: attempts, next_attempt_at: retry ? trx.raw("clock_timestamp() + ? * interval '1 millisecond'", [delay]) : null,
    completed_at: retry ? null : trx.raw('clock_timestamp()'), error_code: result.status === 'failed' ? result.errorCode.slice(0, 100) : null });
}
/** Two transactions are intentional: token issuance must commit before SMTP can
 * expose it. The second transaction reacquires current source/recipient authority
 * and holds it through transport. A lost SMTP acknowledgement can repeat a send
 * with the same Message-ID/token; this is not exactly-once external delivery.
 * Callers must not activate sending until the cm1 inbound adapter is installed. */
export async function processCoManagedRequesterEmailDeliveries(db: Knex, tenant: string,
  send: (delivery: CoManagedRequesterEmailDelivery) => Promise<CoManagedEmailDeliveryResult>, options: { limit?: number } = {}) {
  const limit = options.limit ?? 30;
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid requester email recovery scope');
  const due = (trx: Knex) => tenantDb(trx, tenant).table(TABLE).where('status', 'pending').where('next_attempt_at', '<=', trx.raw('clock_timestamp()'));
  const rows = await due(db).orderBy('next_attempt_at').orderBy('delivery_key').limit(limit);
  async function claim(trx: Knex.Transaction, candidate: any) {
    const row = await due(trx).where('delivery_key', candidate.delivery_key).forUpdate().skipLocked().first();
    if (row && !sameIdentity(row, candidate)) throw new Error('Requester email identity changed');
    return row;
  }
  async function complete(trx: Knex.Transaction, candidate: any, outcome: CoManagedEmailDeliveryResult) {
    const row = await claim(trx, candidate);
    if (!row) return false;
    await finish(trx, row, outcome); return true;
  }
  let processed = 0;
  for (const candidate of rows) {
    try {
      const recipient = recipientOf(candidate), resource = { tenant, kind: 'ticket' as const, id: candidate.ticket_id };
      const prepared = await withTransaction(db, async trx => {
        const result = await withCoManagedRequesterCommentEmail(trx, recipient, resource, candidate.comment_id, async (context, message) => {
          const settings = await coManagedCommentEmailSettings(trx, tenant);
          const row = await claim(trx, candidate);
          if (!row) return { kind: 'done' as const, processed: false };
          if (!settings || message.threadId !== row.thread_id) { await finish(trx, row, { status: 'skipped' }); return { kind: 'done' as const, processed: true }; }
          const issued = await issueCoManagedRequesterReplyToken(trx, { recipient: context.recipient, resource, commentId: message.commentId, deliveryKey: row.delivery_key });
          if (!issued) { await finish(trx, row, { status: 'skipped' }); return { kind: 'done' as const, processed: true }; }
          return { kind: 'ready' as const, ...issued };
        });
        return result ?? { kind: 'done' as const, processed: await complete(trx, candidate, { status: 'skipped' }) };
      });
      if (prepared.kind === 'done') { if (prepared.processed) processed++; continue; }
      const didProcess = await withTransaction(db, async trx => {
        const result = await withCoManagedRequesterCommentEmail(trx, recipient, resource, candidate.comment_id, async (context, message) => {
          const settings = await coManagedCommentEmailSettings(trx, tenant);
          const row = await claim(trx, candidate);
          if (!row) return false;
          if (!settings || message.threadId !== row.thread_id) { await finish(trx, row, { status: 'skipped' }); return true; }
          if (normalize(context.email) !== normalize(prepared.email)) {
            await finish(trx, row, { status: 'failed', retryable: true, errorCode: 'requester_address_changed' }); return true;
          }
          const token = await tenantDb(trx, tenant).table('co_management_requester_reply_tokens').where({ token: prepared.token,
            delivery_key: row.delivery_key, recipient_email: normalize(context.email), recipient_kind: row.recipient_kind,
            recipient_id: row.recipient_id, client_id: row.client_id, ticket_id: row.ticket_id, comment_id: row.comment_id, thread_id: row.thread_id })
            .whereNull('revoked_at').where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()'))).forShare().first('token');
          // PostgreSQL can evaluate the expiry predicate before waiting for a
          // row lock. Recheck database time after that lock has been acquired.
          const stillActive = token && await tenantDb(trx, tenant).table('co_management_requester_reply_tokens')
            .where('token', token.token).where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()'))).first('token');
          if (!stillActive) { await finish(trx, row, { status: 'skipped' }); return true; }
          const messageId = `<co-managed-requester-${createHash('sha256').update(row.delivery_key).digest('hex')}@notifications.alga.invalid>`;
          let outcome: CoManagedEmailDeliveryResult;
          try { outcome = await send({ tenant, recipient: context.recipient, email: context.email, ...settings, messageId, replyToken: token.token, message }); }
          catch { outcome = { status: 'failed', retryable: true, errorCode: 'email_transport_failed' }; }
          if (!outcome || !['delivered', 'skipped', 'failed'].includes(outcome.status)) outcome = { status: 'failed', retryable: true, errorCode: 'invalid_email_transport_result' };
          await finish(trx, row, outcome); return true;
        });
        return result ?? complete(trx, candidate, { status: 'skipped' });
      });
      if (didProcess) processed++;
    } catch (error) {
      await withTransaction(db, trx => complete(trx, candidate, error instanceof CoManagedSharedWorkError ? { status: 'skipped' }
        : { status: 'failed', retryable: true, errorCode: 'email_processing_failed' }));
    }
  }
  return { examined: rows.length, processed };
}
