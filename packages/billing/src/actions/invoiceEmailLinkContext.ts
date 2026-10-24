/**
 * Shared invoice-email link context. Deliberately NOT a `'use server'` module:
 * it is only imported by server actions and the invoice-email job handler, and
 * it exports a pure synchronous eligibility predicate, which Next.js forbids in
 * `'use server'` files (only async functions may be exported from those).
 */

import logger from '@alga-psa/core/logger';
import { isOfflinePaymentMethod } from '@alga-psa/shared/billingClients/paymentPreferences';
import { getPaymentService, expireInvoicePaymentLinksForTerminalStatus } from './paymentActions';
import { buildDurablePaymentUrl, buildPortalInvoiceUrl } from '../lib/payments/invoicePaymentUrls';

// Public API preserved: the builders now live in a worker-safe lib module.
export { buildDurablePaymentUrl, buildPortalInvoiceUrl };

export interface InvoiceEmailLinkContext {
  paymentUrl?: string;
  portalUrl?: string;
  /** Retained for server logging when Checkout link creation fails. */
  paymentError?: Error;
}

export interface InvoiceLinkEligibilityFields {
  invoice_id: string;
  status?: string | null;
  finalized_at?: unknown | null;
  invoice_type?: string | null;
  total_amount?: number | null;
  credit_applied?: number | null;
  /** The invoice's payment-method snapshot (`invoices.payment_method`). */
  payment_method?: string | null;
}

/**
 * Whether an invoice may carry an online "Pay now" link at all. An invoice
 * whose billing profile pays by check or bank transfer was issued asking for
 * that method, so it offers no card checkout. Credit card and invoices with
 * no recorded method (everything generated before the snapshot existed) keep
 * the link.
 */
export function isInvoiceOnlinePaymentAllowed(
  invoice: Pick<InvoiceLinkEligibilityFields, 'payment_method'> | null | undefined,
): boolean {
  return !isOfflinePaymentMethod(invoice?.payment_method);
}

/**
 * An invoice is link-eligible only when it is finalized, not draft/paid/
 * cancelled, not a credit note, and has a positive unpaid balance.
 */
export function isInvoiceLinkEligible(invoice: InvoiceLinkEligibilityFields | null | undefined): boolean {
  if (!invoice) return false;
  if (!invoice.finalized_at) return false;

  const status = (invoice.status ?? '').toLowerCase();
  if (status === 'draft' || status === 'paid' || status === 'cancelled') return false;

  if (invoice.invoice_type === 'credit_note') return false;

  const amountDue = Number(invoice.total_amount ?? 0) - Number(invoice.credit_applied ?? 0);
  if (!Number.isFinite(amountDue) || amountDue <= 0) return false;

  return true;
}

/**
 * Retires still-active Checkout sessions when an invoice email is being built
 * for an invoice that already reached a terminal status. The email never
 * carries a payment link for a paid/cancelled invoice; this cleanup additionally
 * closes the provider session so an earlier email's link stops working.
 * Best-effort: failures are logged and never affect the email itself.
 */
async function retireLinksForTerminalInvoice(
  tenantId: string,
  invoice: InvoiceLinkEligibilityFields
): Promise<void> {
  const status = (invoice.status ?? '').toLowerCase();
  if (status !== 'paid' && status !== 'cancelled') return;
  try {
    await expireInvoicePaymentLinksForTerminalStatus(tenantId, invoice.invoice_id, status);
  } catch (error) {
    logger.error('[billing/invoiceEmailLinkContext] Failed to retire payment links for terminal invoice', {
      tenantId,
      invoiceId: invoice.invoice_id,
      status,
      error,
    });
  }
}

/**
 * Central link context shared by the direct MSP send action and the scheduled
 * invoice email handler.
 *
 * For an eligible invoice it builds the portal URL first, then, only when a
 * provider is enabled and `paymentLinksInEmails` is true, a durable signed
 * `/pay/<token>` URL whose lifetime is the tenant's `paymentLinkExpirationHours`.
 * No Checkout Session is created here: sessions are minted on click (they only
 * live 24h), so the email can never carry a dying `session.url`. Eligibility and
 * provider checks still run. A disabled/unconfigured provider or a token/URL
 * failure yields a portal-only email; the failure is retained in `paymentError`
 * for server logging instead of failing delivery.
 */
export async function getInvoiceEmailLinkContext(
  tenantId: string,
  invoice: InvoiceLinkEligibilityFields
): Promise<InvoiceEmailLinkContext> {
  const context: InvoiceEmailLinkContext = {};

  if (!isInvoiceLinkEligible(invoice)) {
    await retireLinksForTerminalInvoice(tenantId, invoice);
    return context;
  }

  const portalUrl = await buildPortalInvoiceUrl(tenantId, invoice.invoice_id);
  if (portalUrl) {
    context.portalUrl = portalUrl;
  }

  // Offline methods get the portal link only. No Checkout session is created,
  // so the email cannot carry (or later append) a payment URL.
  if (!isInvoiceOnlinePaymentAllowed(invoice)) {
    return context;
  }

  try {
    const paymentService = await getPaymentService(tenantId);
    if (!paymentService) {
      // CE build or no EE payment service: expected absence, portal-only email.
      return context;
    }

    const hasProvider = await paymentService.hasEnabledProvider();
    const settings = await paymentService.getPaymentSettings();

    if (hasProvider && settings?.paymentLinksInEmails) {
      try {
        const paymentUrl = await buildDurablePaymentUrl(
          tenantId,
          invoice.invoice_id,
          settings.paymentLinkExpirationHours,
        );
        if (paymentUrl) {
          context.paymentUrl = paymentUrl;
        }
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        context.paymentError = wrapped;
        logger.error('[billing/invoiceEmailLinkContext] Failed to build durable payment link', {
          tenantId,
          invoiceId: invoice.invoice_id,
          error: wrapped,
        });
      }
    }
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    context.paymentError = wrapped;
    logger.error('[billing/invoiceEmailLinkContext] Payment service unavailable', {
      tenantId,
      invoiceId: invoice.invoice_id,
      error: wrapped,
    });
  }

  return context;
}
