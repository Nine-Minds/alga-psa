/**
 * Decision logic for the public, unauthenticated `/pay/<token>` route.
 *
 * Deliberately NOT a `'use server'` module (it exports non-action helpers and
 * must never be callable from the browser). There is no user session: the
 * tenant comes ONLY from the verified token, and every query is tenant-scoped
 * via `tenantDb`, the same way the scheduled invoice-email handler runs.
 *
 * Outcome is either a redirect to a provider Checkout URL, or a `fallback`
 * telling the page to render a friendly message pointing at the client portal.
 * The token never carries an amount; the balance is recomputed inside
 * `PaymentService.getOrCreatePaymentLink`.
 */

import logger from '@alga-psa/core/logger';
import { getConnection, tenantDb } from '@alga-psa/db';
import { verifyPaymentLinkToken } from '../lib/payments/paymentLinkToken';
import {
  buildPortalInvoiceUrl,
  isInvoiceLinkEligible,
  isInvoiceOnlinePaymentAllowed,
  type InvoiceLinkEligibilityFields,
} from './invoiceEmailLinkContext';
import { getPaymentService } from './paymentActions';

export type PayLinkFallbackReason =
  | 'invalid'
  | 'expired'
  | 'not_payable'
  | 'unavailable';

export type PayLinkResolution =
  | { kind: 'redirect'; url: string }
  | { kind: 'fallback'; reason: PayLinkFallbackReason; portalUrl: string | null };

export interface PayLinkDeps {
  now: () => Date;
  loadInvoice: (tenantId: string, invoiceId: string) => Promise<InvoiceLinkEligibilityFields | null>;
  /** Active/new provider session URL, or null when none can be produced. May throw. */
  getCheckoutUrl: (tenantId: string, invoiceId: string) => Promise<string | null>;
  buildPortalUrl: (tenantId: string, invoiceId: string) => Promise<string | null>;
}

/**
 * Only follow absolute https URLs from the provider (http only outside
 * production, for local emulators). Defense in depth against an open redirect:
 * the URL is never taken from the request.
 */
export function isSafeCheckoutRedirect(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

const defaultDeps: PayLinkDeps = {
  now: () => new Date(),
  async loadInvoice(tenantId, invoiceId) {
    const knex = await getConnection();
    const row = await tenantDb(knex, tenantId)
      .table('invoices')
      .where({ invoice_id: invoiceId })
      .first<InvoiceLinkEligibilityFields | undefined>(
        'invoice_id', 'status', 'finalized_at', 'invoice_type',
        'total_amount', 'credit_applied', 'payment_method',
      );
    return row ?? null;
  },
  async getCheckoutUrl(tenantId, invoiceId) {
    const paymentService = await getPaymentService(tenantId);
    if (!paymentService) return null;
    if (!(await paymentService.hasEnabledProvider())) return null;
    const link = await paymentService.getOrCreatePaymentLink(invoiceId);
    return link?.url ?? null;
  },
  buildPortalUrl: buildPortalInvoiceUrl,
};

export async function resolvePayLink(
  token: string,
  deps: PayLinkDeps = defaultDeps,
): Promise<PayLinkResolution> {
  const verified = verifyPaymentLinkToken(token, deps.now());
  if (!verified.ok) {
    // Tenant is unknown for an unverifiable token, so there is no portal URL to offer.
    return { kind: 'fallback', reason: verified.reason, portalUrl: null };
  }

  const { tenantId, invoiceId } = verified;
  const portalUrl = await deps.buildPortalUrl(tenantId, invoiceId).catch(() => null);
  const fallback = (reason: PayLinkFallbackReason): PayLinkResolution => ({ kind: 'fallback', reason, portalUrl });

  try {
    const invoice = await deps.loadInvoice(tenantId, invoiceId);
    if (!invoice || !isInvoiceLinkEligible(invoice) || !isInvoiceOnlinePaymentAllowed(invoice)) {
      return fallback('not_payable');
    }

    const url = await deps.getCheckoutUrl(tenantId, invoiceId);
    if (!url) return fallback('not_payable');
    if (!isSafeCheckoutRedirect(url)) {
      logger.error('[billing/payLinkResolver] Rejected unsafe checkout redirect URL', { tenantId, invoiceId });
      return fallback('unavailable');
    }
    return { kind: 'redirect', url };
  } catch (error) {
    logger.error('[billing/payLinkResolver] Failed to resolve payment link', { tenantId, invoiceId, error });
    return fallback('unavailable');
  }
}
