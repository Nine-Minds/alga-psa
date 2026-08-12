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
   * The remaining payable balance (cents) after the mutation. When the invoice
   * did not reach a terminal status, EE handlers use this to retire only the
   * active links whose stored amount no longer matches — a partial payment or
   * credit application must not leave a full-balance Checkout session live.
   */
  balanceDue?: number;
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

// Memoized edition-tolerant load of the EE payments module. EE registers its
// terminal-status handler as a module side effect, so pulling the module in on
// first use is what makes a terminal transition retire active links even when
// the QBO sync or alternative-payments caller is the first thing in the
// process to reach `recordExternalPayment` (no other EE import has happened).
let terminalStatusHandlerLoad: Promise<void> | null = null;

/**
 * Lazily ensures the EE payments module that registers the terminal-status
 * handler is loaded before handlers are invoked. Edition-tolerant (mirrors the
 * pattern in paymentActions/paymentWebhookHelpers): a failed load — a CE build
 * where the `@enterprise/lib/payments` alias is unresolved — is logged and
 * never thrown, so payment recording never fails because of this. The promise
 * is memoized so the import runs at most once per process. If an eager EE
 * import already registered a handler (the Stripe webhook path), this is a
 * no-op; both paths import the same specifier, so the module cache guarantees
 * a single registration — never zero, never two.
 */
async function ensureTerminalStatusHandlerRegistered(): Promise<void> {
  if (handlers.length > 0) {
    return;
  }
  terminalStatusHandlerLoad ??= (async () => {
    try {
      await import('@enterprise/lib/payments');
    } catch (error) {
      logger.debug(
        '[billing/invoiceTerminalStatusHandlers] enterprise payments module not available; terminal-status handlers stay unregistered',
        { error }
      );
    }
  })();
  await terminalStatusHandlerLoad;
}

/** Registers a handler invoked when an invoice reaches a terminal status. */
export function registerInvoiceTerminalStatusHandler(handler: InvoiceTerminalStatusHandler): void {
  handlers.push(handler);
}

/**
 * Invokes every registered terminal-status handler. The EE module that owns
 * the sole in-memory handler is pulled in first so the first-ever terminal
 * transition in a process still retires active links. Tenant-scoped work is
 * the handler's responsibility; failures are logged and never propagated so
 * the payment recording that triggered the transition is unaffected.
 */
export async function notifyInvoiceTerminalStatus(params: InvoiceTerminalStatusParams): Promise<void> {
  await ensureTerminalStatusHandlerRegistered();
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

/**
 * Tenant-scoped query of an invoice's links whose provider expiration
 * previously failed (`expire_pending`). These rows are the durable handle a
 * terminal/balance cleanup uses to retry the provider closure before anything
 * else — a link blocked from reuse but whose Checkout Session may still be
 * open must never be abandoned. Kept here so the query shape is owned
 * alongside the registry.
 */
export function listPendingInvoicePaymentLinks(
  knex: Knex,
  tenantId: string,
  invoiceId: string
): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(knex, tenantId)
    .table<Record<string, unknown>>('invoice_payment_links')
    .where({ invoice_id: invoiceId, status: 'expire_pending' })
    .orderBy('created_at', 'asc');
}
