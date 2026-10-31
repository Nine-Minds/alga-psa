import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { CO_MANAGED_LEDGER, claimDelivery, finishDelivery } from '@shared/lib/deliveryLedger';
import { pendingCoManagedSlaDeliveries, withCoManagedSlaNotification, SLA_EMAIL_KIND, SLA_IN_APP_KIND, type CoManagedSlaDeliveryRow } from '@alga-psa/co-managed';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import { coManagedSlaPresentation } from '@alga-psa/notifications/lib/coManagedSlaPresentation';
import { readUserEmailPreferenceState } from '@alga-psa/notifications/notifications/userEmailPreferences';
import { sendEventEmail } from './sendEventEmail';

const baseUrl = () => (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ledgerKey = (row: CoManagedSlaDeliveryRow) => ({ delivery_kind: row.deliveryKind, source_id: row.eventId, recipient: row.recipient });
const DENIED = Symbol('denied');

/** Deliver ONE owed SLA row through L5's ledger. The recipient is reauthorized against current co-managed state first
 * (the same recipient context routing uses). A recipient who is no longer permitted is a completed (skipped) delivery. */
export async function deliverCoManagedSlaRow(db: Knex, row: CoManagedSlaDeliveryRow): Promise<'sent' | 'skipped' | 'failed'> {
  const actor = { kind: 'notification_recipient' as const, tenant: row.tenant, userId: row.userId };
  const key = ledgerKey(row);
  const skip = async () => {
    if (await claimDelivery(db, CO_MANAGED_LEDGER, row.tenant, key, { recipient_kind: 'msp_user' })) {
      await finishDelivery(db, CO_MANAGED_LEDGER, row.tenant, key, 'sent', { errorCode: 'recipient_not_permitted' });
    }
    return 'skipped' as const;
  };
  try {
    if (row.deliveryKind === SLA_IN_APP_KIND) {
      // Claim + create + mark sent in the authorized transaction (L5 in-app delivery); broadcast follows the commit.
      const done = await withCoManagedSlaNotification(db, actor, row.eventId, 'in_app', async (context, message) => {
        const presentation = coManagedSlaPresentation(message);
        await createNotificationFromTemplateInternal(context.trx, {
          tenant: row.tenant, user_id: row.userId, template_name: `sla-${message.notificationType}`,
          type: message.notificationType === 'breach' ? 'error' : 'warning', category: 'sla', ...presentation,
        }, { delivery: { ledger: CO_MANAGED_LEDGER, key, extra: { recipient_kind: 'msp_user' } } });
        return true;
      });
      return done ? 'sent' : await skip();
    }
    if (row.deliveryKind !== SLA_EMAIL_KIND) return 'skipped';
    const subtypeName = (type: string) => type === 'breach' ? 'SLA Breach' : 'SLA Warning';
    const ready = await withCoManagedSlaNotification(db, actor, row.eventId, 'email', async (context, message) => {
      const user = await tenantDb(context.trx, row.tenant).table('users')
        .where({ user_id: row.userId, user_type: 'internal', is_inactive: false }).forShare().first('email', 'first_name', 'last_name');
      if (typeof user?.email !== 'string' || !EMAIL.test(user.email.trim())) return DENIED;
      // Tenant, category, subtype and the user's own email preference, from the one shared preference state.
      const subtype = (await readUserEmailPreferenceState(context.trx, row.tenant, row.userId))
        .flatMap(category => category.subtypes).find(candidate => candidate.name === subtypeName(message.notificationType));
      if (!subtype) throw new Error('SLA email notification subtype is not configured');
      if (!subtype.effective_is_enabled) return DENIED;
      const email = user.email.trim();
      return { message, email, subtypeId: subtype.id, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || email };
    });
    if (!ready || ready === DENIED) return await skip();
    const presentation = coManagedSlaPresentation(ready.message);
    await sendEventEmail({
      mailClass: 'ticket', tenantId: row.tenant, to: ready.email, recipientUserId: row.userId, notificationSubtypeId: ready.subtypeId,
      subject: `SLA ${ready.message.notificationType === 'breach' ? 'breach' : 'warning'}: ticket #${ready.message.ticketNumber ?? ''}`,
      template: `sla-${ready.message.notificationType}`,
      context: { ...presentation.data, recipientName: ready.name, ticketUrl: `${baseUrl()}${presentation.link}` },
      delivery: { ledger: CO_MANAGED_LEDGER, key, extra: { recipient_kind: 'msp_user' } },
    });
    return 'sent';
  } catch (error) {
    // The ledger row is already `failed` (retryable) or `sending`+requires_reconciliation (unknown outcome), or still `pending`.
    logger.warn('[CoManagedSla] delivery failed; recovery retries owed rows only', {
      tenant: row.tenant, kind: row.deliveryKind, eventId: row.eventId, error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
}

export async function deliverCoManagedSlaNotifications(db: Knex, tenant: string, limit = 100) {
  const tally = { sent: 0, skipped: 0, failed: 0 };
  for (const row of await pendingCoManagedSlaDeliveries(db, tenant, limit)) tally[await deliverCoManagedSlaRow(db, row)] += 1;
  return tally;
}
