/**
 * Invoice terminal-status handler registry.
 *
 * `recordExternalPayment` settles automated payments (Stripe webhook, QBO
 * sync, alternative-payments webhook) and can flip an invoice to a terminal
 * status. That module lives in the shared billing package, which must not
 * depend on the EE payment stack, so EE registers a handler here instead of
 * being imported directly. Handler failures are isolated per handler: they are
 * logged and never fail the originating payment recording.
 *
 * The safety property this exists to enforce: when an invoice reaches a
 * terminal status, its active Stripe Checkout sessions must be retired so an
 * old email link can never charge a settled invoice.
 */

import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';

export interface InvoiceTerminalStatusParams {
  knex: Knex;
  tenantId: string;
  invoiceId: string;
  newStatus: string;
  /**
   * The payment reference that just settled. EE handlers use it as a secondary
   * match for the settling Stripe session's own link (its
   * `metadata.payment_intent`); it is not authoritative because payment-mode
   * Checkout Sessions defer PaymentIntent creation under apiVersion
   * 2024-12-18.acacia.
   */
  settledReference?: string;
  /**
   * The Checkout Session/link id that just settled. Authoritative for excluding
   * the settling session's own link (matched against `external_link_id`),
   * which is always known for checkout.session.* events.
   */
  settledExternalId?: string;
}

export type InvoiceTerminalStatusHandler = (params: InvoiceTerminalStatusParams) => Promise<void>;

const handlers: InvoiceTerminalStatusHandler[] = [];

/** Registers a handler invoked when an invoice reaches a terminal status. */
export function registerInvoiceTerminalStatusHandler(handler: InvoiceTerminalStatusHandler): void {
  handlers.push(handler);
}

/**
 * Invokes every registered terminal-status handler. Tenant-scoped work is the
 * handler's responsibility; failures are logged and never propagated so the
 * payment recording that triggered the transition is unaffected.
 */
export async function notifyInvoiceTerminalStatus(params: InvoiceTerminalStatusParams): Promise<void> {
  for (const handler of [...handlers]) {
    try {
      await handler(params);
    } catch (error) {
      logger.error('[billing/recordExternalPayment] Invoice terminal-status handler failed', {
        tenantId: params.tenantId,
        invoiceId: params.invoiceId,
        newStatus: params.newStatus,
        error,
      });
    }
  }
}

/**
 * Tenant-scoped query of the active payment links for an invoice. EE's handler
 * uses this to retire links, skipping the settling session's own link. Kept
 * here so the query shape is owned alongside the registry.
 */
export function listActiveInvoicePaymentLinks(
  knex: Knex,
  tenantId: string,
  invoiceId: string,
  options?: { excludeSettledExternalId?: string; excludeSettledReference?: string }
): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  const query = tenantDb(knex, tenantId)
    .table<Record<string, unknown>>('invoice_payment_links')
    .where({ invoice_id: invoiceId, status: 'active' });

  if (options?.excludeSettledExternalId) {
    // Authoritative exclusion: the Checkout Session that just settled is
    // confirmed closed by the completion webhook itself, so its link must not
    // be retired here.
    query.whereNot({ external_link_id: options.excludeSettledExternalId });
  }

  if (options?.excludeSettledReference) {
    // Secondary match: keep every link except the one whose stored payment
    // intent equals the settled reference. `IS DISTINCT FROM` also keeps rows
    // whose payment_intent is null/absent (the normal case under acacia).
    query.where(
      knex.raw(`metadata->>'payment_intent' IS DISTINCT FROM ?`, [
        options.excludeSettledReference,
      ])
    );
  }

  return query.orderBy('created_at', 'asc');
}
