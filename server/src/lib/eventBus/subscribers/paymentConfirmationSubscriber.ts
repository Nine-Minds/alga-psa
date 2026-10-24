/**
 * Payment Confirmation Subscriber
 *
 * Sends the localized `payment-received` email to the client's billing
 * recipient when PAYMENT_RECORDED fires and the tenant has
 * an enabled payment provider config with `sendPaymentConfirmations` on.
 *
 * Safety properties:
 *  - Provenance is default-deny: only the PAYMENT_CONFIRMATION_SOURCES
 *    allow-list is sent. A missing/unknown `source` (and `accounting_sync`)
 *    never emails, so a sync/backfill cannot mail a client's payment history.
 *  - At most one email per (tenant, payment_id): a row in
 *    `payment_confirmation_emails` is claimed (INSERT .. ON CONFLICT DO
 *    NOTHING) before sending, independent of the bus idempotency key.
 *  - "No recipient" / "setting off" are terminal skips, never thrown, so the
 *    bus does not redeliver them forever. Only a retryable provider failure
 *    releases the claim and rethrows.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import { DEFAULT_PAYMENT_SETTINGS } from '@alga-psa/types';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services';
import { buildPortalInvoiceUrl } from '@alga-psa/billing/actions/invoiceEmailLinkContext';
import { formatCurrencyFromMinorUnits, formatDate } from '@alga-psa/core/formatters';
import { getUserInfoForEmail, resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { sendEventEmail } from '../../notifications/sendEventEmail';
import type { Knex } from 'knex';

const PAYMENT_RECEIVED_TEMPLATE = 'payment-received';
const CONFIRMATION_TABLE = 'payment_confirmation_emails';

/** Provenances that may trigger a confirmation. Everything else is denied. */
export const PAYMENT_CONFIRMATION_SOURCES: readonly string[] = ['online_payment', 'manual'];

export function isConfirmableSource(source: unknown): boolean {
  return typeof source === 'string' && PAYMENT_CONFIRMATION_SOURCES.includes(source);
}

let isRegistered = false;

export async function registerPaymentConfirmationSubscriber(): Promise<void> {
  if (isRegistered) return;
  await getEventBus().subscribe('PAYMENT_RECORDED', handlePaymentRecordedEvent);
  isRegistered = true;
  logger.info('[PaymentConfirmationSubscriber] Registered');
}

export async function unregisterPaymentConfirmationSubscriber(): Promise<void> {
  if (!isRegistered) return;
  await getEventBus().unsubscribe('PAYMENT_RECORDED', handlePaymentRecordedEvent);
  isRegistered = false;
  logger.info('[PaymentConfirmationSubscriber] Unregistered');
}

/**
 * Tenant setting. The "Send payment confirmations" toggle only exists in EE
 * and only renders when an enabled `payment_provider_configs` row exists. A
 * missing table (CE) or no enabled config therefore means the tenant has no
 * visible control and cannot have opted in, so no confirmation is sent. With
 * an enabled config the tenant can see (and turn off) the toggle, so an absent
 * key keeps the design default (on); the UI shows the same value because
 * PaymentService.getPaymentSettings merges DEFAULT_PAYMENT_SETTINGS.
 */
async function isPaymentConfirmationEnabled(knex: Knex, tenantId: string): Promise<boolean> {
  if (!(await knex.schema.hasTable('payment_provider_configs'))) {
    return false;
  }
  const config = await tenantDb(knex, tenantId)
    .table('payment_provider_configs')
    .where({ is_enabled: true })
    .orderBy('is_default', 'desc')
    .first<{ settings?: { sendPaymentConfirmations?: boolean } | null }>();
  if (!config) {
    return false;
  }
  const configured = config.settings?.sendPaymentConfirmations;
  return typeof configured === 'boolean' ? configured : DEFAULT_PAYMENT_SETTINGS.sendPaymentConfirmations;
}

export async function handlePaymentRecordedEvent(event: unknown): Promise<void> {
  // Gate on the raw provenance BEFORE schema validation: a missing or unknown
  // value must be a quiet skip, not a validation throw the bus would redeliver.
  const rawPayload = (event as { payload?: Record<string, unknown> } | null)?.payload;
  if (!isConfirmableSource(rawPayload?.source)) {
    logger.info('[PaymentConfirmationSubscriber] Skipping: provenance not eligible for confirmation', {
      tenantId: rawPayload?.tenantId,
      paymentId: rawPayload?.paymentId,
      source: rawPayload?.source ?? null,
    });
    return;
  }

  const validated = EventSchemas.PAYMENT_RECORDED.parse(event);
  const { tenantId, paymentId } = validated.payload;

  await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenantId);

    if (!(await isPaymentConfirmationEnabled(knex, tenantId))) {
      logger.info('[PaymentConfirmationSubscriber] Skipping: sendPaymentConfirmations is off', { tenantId, paymentId });
      return;
    }

    const payment = await db
      .table('invoice_payments')
      .where({ payment_id: paymentId })
      .first<{ invoice_id: string; amount: number | string; payment_method: string | null; payment_date: Date | string | null }>();
    if (!payment || Number(payment.amount) <= 0) {
      logger.warn('[PaymentConfirmationSubscriber] Skipping: payment row not found or not positive', { tenantId, paymentId });
      return;
    }

    const invoice = await db
      .table('invoices')
      .where({ invoice_id: payment.invoice_id })
      .first<{
        invoice_id: string;
        invoice_number: string;
        client_id: string;
        billing_profile_id?: string | null;
        currency_code?: string | null;
      }>();
    if (!invoice) {
      logger.warn('[PaymentConfirmationSubscriber] Skipping: invoice not found', { tenantId, paymentId });
      return;
    }

    // Same resolution the invoice email path uses (profile → billing contact → billing email → locations).
    const recipient = await resolveInvoiceBillingRecipient({
      knexOrTrx: knex,
      tenantId,
      clientId: invoice.client_id,
      billingProfileId: invoice.billing_profile_id ?? null,
    });
    if (!recipient.recipientEmail) {
      logger.info('[PaymentConfirmationSubscriber] Skipping: no billing recipient for client', {
        tenantId,
        paymentId,
        clientId: invoice.client_id,
      });
      return;
    }

    // Claim the (tenant, payment_id) marker; a loser of the race or a replay sends nothing.
    const claimed = await db
      .table(CONFIRMATION_TABLE)
      .insert({ tenant: tenantId, payment_id: paymentId, recipient_email: recipient.recipientEmail })
      .onConflict(['tenant', 'payment_id'])
      .ignore()
      .returning('payment_id');
    if (!claimed || claimed.length === 0) {
      logger.info('[PaymentConfirmationSubscriber] Skipping: confirmation already claimed for payment', { tenantId, paymentId });
      return;
    }

    try {
      const baseInfo = (await getUserInfoForEmail(tenantId, recipient.recipientEmail)) || {
        email: recipient.recipientEmail,
      };
      const locale = await resolveEmailLocale(tenantId, { ...baseInfo, clientId: invoice.client_id });
      const currency = (invoice.currency_code || validated.payload.currency || 'USD').toUpperCase();
      // Null when no absolute public base exists: the template then omits the link.
      const portalUrl = await buildPortalInvoiceUrl(tenantId, invoice.invoice_id);

      await sendEventEmail({
        mailClass: 'billing',
        tenantId,
        to: recipient.recipientEmail,
        subject: 'Payment received',
        template: PAYMENT_RECEIVED_TEMPLATE,
        locale,
        recipientClientId: invoice.client_id,
        entityType: 'invoice',
        entityId: invoice.invoice_id,
        context: {
          invoice: {
            number: invoice.invoice_number,
            clientName: recipient.clientName,
            amountPaid: formatCurrencyFromMinorUnits(Number(payment.amount), locale, currency),
            paymentDate: formatDate(payment.payment_date ?? validated.payload.receivedAt, locale),
            paymentMethod: payment.payment_method ?? validated.payload.method,
            url: portalUrl ?? undefined,
          },
        },
      });

      logger.info('[PaymentConfirmationSubscriber] Sent payment confirmation', {
        tenantId,
        paymentId,
        invoiceId: invoice.invoice_id,
      });
    } catch (error) {
      const retryable = (error as { isRetryable?: boolean } | null)?.isRetryable === true;
      logger.error('[PaymentConfirmationSubscriber] Failed to send payment confirmation', {
        tenantId,
        paymentId,
        retryable,
        error: error instanceof Error ? error.message : String(error),
      });
      if (retryable) {
        // Nothing was delivered: release the claim so the redelivery can send.
        await db.table(CONFIRMATION_TABLE).where({ payment_id: paymentId }).delete();
        throw error;
      }
      // Non-retryable / unknown outcome: keep the claim (at most one email), do not redeliver.
    }
  });
}
