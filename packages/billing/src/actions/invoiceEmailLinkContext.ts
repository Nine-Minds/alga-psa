/**
 * Shared invoice-email link context. Deliberately NOT a `'use server'` module:
 * it is only imported by server actions and the invoice-email job handler, and
 * it exports a pure synchronous eligibility predicate, which Next.js forbids in
 * `'use server'` files (only async functions may be exported from those).
 */

import logger from '@alga-psa/core/logger';
import { getPortalDomainStatusForTenant } from '@alga-psa/tenancy/server';
import { getPaymentService } from './paymentActions';

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
 * Builds the authenticated client-portal invoices URL for an invoice,
 * preferring an active tenant vanity domain, then the configured public app
 * URLs. Returns null when no valid public base exists (the portal CTA is
 * omitted from the email rather than leaking an internal worker hostname).
 */
export async function buildPortalInvoiceUrl(tenantId: string, invoiceId: string): Promise<string | null> {
  let vanityBaseUrl = '';
  try {
    const portalDomain = await getPortalDomainStatusForTenant(tenantId);
    if (portalDomain.status === 'active' && portalDomain.domain) {
      vanityBaseUrl = `https://${portalDomain.domain}`;
    }
  } catch (error) {
    logger.warn('[billing/invoiceEmailLinkContext] Failed to resolve custom portal domain', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const baseUrl =
    vanityBaseUrl ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.HOST ? `https://${process.env.HOST}` : '');

  if (!baseUrl) return null;

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    logger.warn('[billing/invoiceEmailLinkContext] Invalid public base URL', { tenantId, baseUrl });
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    return null;
  }

  const url = new URL('/client-portal/billing', base);
  url.searchParams.set('tab', 'invoices');
  url.searchParams.set('invoiceId', invoiceId);
  return url.toString();
}

/**
 * Central link context shared by the direct MSP send action and the scheduled
 * invoice email handler.
 *
 * For an eligible invoice it builds the portal URL first, then requests a
 * Stripe Checkout URL only when a provider is enabled and `paymentLinksInEmails`
 * is true. A disabled/unconfigured provider or a Checkout creation failure
 * yields a portal-only email; the creation failure is retained in
 * `paymentError` for server logging instead of failing delivery.
 */
export async function getInvoiceEmailLinkContext(
  tenantId: string,
  invoice: InvoiceLinkEligibilityFields
): Promise<InvoiceEmailLinkContext> {
  const context: InvoiceEmailLinkContext = {};

  if (!isInvoiceLinkEligible(invoice)) {
    return context;
  }

  const portalUrl = await buildPortalInvoiceUrl(tenantId, invoice.invoice_id);
  if (portalUrl) {
    context.portalUrl = portalUrl;
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
        const link = await paymentService.getOrCreatePaymentLink(invoice.invoice_id);
        if (link?.url) {
          context.paymentUrl = link.url;
        }
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        context.paymentError = wrapped;
        logger.error('[billing/invoiceEmailLinkContext] Failed to create payment link', {
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
