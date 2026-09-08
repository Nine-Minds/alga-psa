import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { withCoManagedSlaNotification, type CoManagedSlaNotification } from './slaNotification';
import { coManagedInternalEmailRecipient } from './commentEmailRecipient';
import type { CoManagedEmailDeliveryResult } from './commentEmailDeliveries';

export interface CoManagedSlaEmailDelivery {
  tenant: string; recipientUserId: string; email: string; recipientName: string; subtypeId?: number;
  messageId: string; message: CoManagedSlaNotification;
}
const TABLE = 'sla_organization_notification_recipients';
const key = (row: any) => ({ notification_event_id: row.notification_event_id, recipient_user_id: row.recipient_user_id, channel: 'email' });
// LEVERAGE: pattern comment-email-completion — source-qualified SLA email shares the existing bounded retry policy; receipt identity differs.
async function finish(trx: Knex.Transaction, row: any, result: CoManagedEmailDeliveryResult) {
  const attempts = row.attempt_count + 1, retry = result.status === 'failed' && result.retryable && attempts < 10;
  const delay = Math.min(3600000, Math.max(60000 * 2 ** Math.min(attempts - 1, 6),
    result.status === 'failed' && Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 0));
  const code = result.status === 'failed' ? (/^[a-z0-9_]{1,100}$/.test(result.errorCode) ? result.errorCode : 'email_transport_failed') : null;
  await tenantDb(trx, row.tenant).table(TABLE).where(key(row)).update({ status: retry ? 'pending' : result.status,
    attempt_count: attempts, next_attempt_at: retry ? trx.raw("clock_timestamp() + ? * interval '1 millisecond'", [delay]) : null,
    completed_at: retry ? null : trx.raw('clock_timestamp()'), error_code: code });
}

/** Reauthorize the source/recipient before claiming its email row and await the
 * provider while those locks remain retained. A lost commit after provider
 * acceptance can repeat a stable Message-ID; SMTP is not exactly once. */
export async function processCoManagedSlaEmailDeliveries(db: Knex, tenant: string,
  send: (delivery: CoManagedSlaEmailDelivery) => Promise<CoManagedEmailDeliveryResult>, limit = 30) {
  if (!isCoManagedUuid(tenant) || !Number.isSafeInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid SLA email batch');
  tenant = tenant.toLowerCase();
  const due = (conn: Knex, candidate?: any) => {
    const query = tenantDb(conn, tenant).table(TABLE).where({ channel: 'email', status: 'pending' })
      .where('next_attempt_at', '<=', conn.raw('clock_timestamp()'));
    return candidate ? query.where(key(candidate)) : query;
  };
  const rows = await due(db).orderBy('next_attempt_at').orderBy('notification_event_id').orderBy('recipient_user_id').limit(limit);
  let processed = 0;
  for (const candidate of rows) {
    try {
      const done = await withTransaction(db, async trx => {
        const delivered = await withCoManagedSlaNotification(trx, { kind: 'notification_recipient', tenant, userId: candidate.recipient_user_id },
          candidate.notification_event_id, 'email', async (context, message) => {
            const to = await coManagedInternalEmailRecipient(context, message.notificationType === 'breach' ? 'SLA Breach' : 'SLA Warning');
            if (to && to.subtypeId === undefined) throw new Error('SLA email notification subtype is not configured');
            const row = await due(trx, candidate).forUpdate().skipLocked().first();
            if (!row) return false;
            if (!to) { await finish(trx, row, { status: 'skipped' }); return true; }
            const user = await tenantDb(trx, tenant).table('users').where('user_id', context.actor.userId).first('first_name', 'last_name');
            const identity = `${tenant}:${row.notification_event_id}:${row.recipient_user_id}:email`;
            const messageId = `<co-managed-sla-${createHash('sha256').update(identity).digest('hex')}@notifications.alga.invalid>`;
            let result: CoManagedEmailDeliveryResult;
            try { result = await send({ tenant, recipientUserId: context.actor.userId, ...to,
              recipientName: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || to.email, messageId, message }); }
            catch { result = { status: 'failed', retryable: true, errorCode: 'email_transport_failed' }; }
            if (!result || !['delivered', 'skipped', 'failed'].includes(result.status)) result = { status: 'failed', retryable: true, errorCode: 'invalid_email_transport_result' };
            await finish(trx, row, result); return true;
          });
        if (delivered !== null) return delivered;
        const row = await due(trx, candidate).forUpdate().skipLocked().first();
        if (!row) return false;
        await finish(trx, row, { status: 'skipped' }); return true;
      });
      if (done) processed++;
    } catch {
      const done = await withTransaction(db, async trx => {
        const row = await due(trx, candidate).forUpdate().skipLocked().first();
        if (!row) return false;
        await finish(trx, row, { status: 'failed', retryable: true, errorCode: 'email_processing_failed' }); return true;
      });
      if (done) processed++;
    }
  }
  return { examined: rows.length, processed };
}
