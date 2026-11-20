import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CO_MANAGED_LEDGER, flagStaleSendingDeliveries } from '@alga-psa/shared/lib/deliveryLedger';
import { fanoutCoManagedSlaNotification } from './slaNotification';
import { isCoManagedUuid } from './sharedWorkIdentity';

/** SLA notices ride L5's single delivery ledger (`co_management_deliveries`): one in-app and one email row per
 * recipient, keyed (tenant, delivery_kind, source_id = notification event, recipient). Claim/finish and retry state are
 * the ledger's. L5's own recovery sweep covers routing kinds only, so a `sending` SLA row whose outcome is unknown is
 * flagged `requires_reconciliation` by `flagStaleCoManagedSlaSending` (called by the SLA observation pass); it is never
 * re-sent. Nothing here keeps its own receipt or retry counters. */
export const SLA_IN_APP_KIND = 'sla_in_app';
export const SLA_EMAIL_KIND = 'sla_email';
const SLA_KINDS = [SLA_IN_APP_KIND, SLA_EMAIL_KIND];
const MAX_ATTEMPTS = 10;

export interface CoManagedSlaDeliveryPayload { eventId: string; userId: string }
export interface CoManagedSlaDeliveryRow { tenant: string; deliveryKind: string; eventId: string; userId: string; recipient: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Capture the currently eligible recipients of one retained crossing as `pending` ledger rows. Eligibility is
 * decided again, per recipient, when the row is delivered. Idempotent per (kind, event, recipient). */
export async function enqueueCoManagedSlaDeliveries(db: Knex, tenant: string, eventId: string): Promise<void> {
  await fanoutCoManagedSlaNotification(db, tenant, eventId, async (context, message, channel) => {
    const userId = context.actor.userId;
    let recipient: string = userId;
    if (channel === 'email') {
      const user = await tenantDb(context.trx, tenant).table('users').where({ user_id: userId, user_type: 'internal', is_inactive: false }).first('email');
      if (typeof user?.email !== 'string' || !EMAIL.test(user.email.trim())) return;
      recipient = user.email.trim().toLowerCase();
    }
    const payload: CoManagedSlaDeliveryPayload = { eventId: message.eventId, userId };
    // write-admission: exempt — delivery ledger row written in the recipient-authorized fanout transaction
    await tenantDb(context.trx, tenant).table('co_management_deliveries').insert({ tenant, delivery_kind: channel === 'email' ? SLA_EMAIL_KIND : SLA_IN_APP_KIND,
      source_id: message.eventId, recipient, recipient_kind: 'msp_user', state: 'pending', attempts: 0, payload: JSON.stringify(payload) })
      .onConflict(['tenant', 'delivery_kind', 'source_id', 'recipient']).ignore();
  });
}

/** A `sending` SLA row older than this lost its worker between claim and finish. */
export const SLA_STALE_SENDING_MS = 15 * 60 * 1000;

/** Flag stale `sending` SLA rows `requires_reconciliation` (unknown provider outcome), so they are never resent. */
export async function flagStaleCoManagedSlaSending(db: Knex, tenant: string, olderThanMs = SLA_STALE_SENDING_MS): Promise<number> {
  // write-admission: exempt — delivery-ledger reconciliation flag on a stale claim, not a co-managed work write
  return flagStaleSendingDeliveries(db, CO_MANAGED_LEDGER, tenant, SLA_KINDS, olderThanMs);
}

/** Owed SLA rows: `pending`, or `failed` and still under the retry bound. `sending` is never listed: an unknown
 * provider outcome needs reconciliation, not a duplicate. */
export async function pendingCoManagedSlaDeliveries(db: Knex, tenant: string, limit = 100): Promise<CoManagedSlaDeliveryRow[]> {
  if (!isCoManagedUuid(tenant) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid SLA delivery scan');
  tenant = tenant.toLowerCase();
  const rows = await tenantDb(db, tenant).table('co_management_deliveries').whereIn('delivery_kind', SLA_KINDS).whereIn('state', ['pending', 'failed'])
    .where('attempts', '<', MAX_ATTEMPTS).orderBy('created_at').limit(limit);
  return rows.flatMap((row): CoManagedSlaDeliveryRow[] => {
    const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as CoManagedSlaDeliveryPayload | null;
    return payload && isCoManagedUuid(payload.eventId) && isCoManagedUuid(payload.userId)
      ? [{ tenant, deliveryKind: row.delivery_kind, eventId: payload.eventId, userId: payload.userId, recipient: row.recipient }] : [];
  });
}
