'use server';

import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import { isInvoiceLinkEligible, isInvoiceOnlinePaymentAllowed } from './invoiceEmailLinkContext';
import { buildDurablePaymentUrl } from '../lib/payments/invoicePaymentUrls';
import { getPaymentService } from './paymentActions';

export type InvoicePaymentLinkRefusalReason =
  | 'invoice-not-found'
  | 'invoice-voided'
  | 'invoice-paid'
  | 'invoice-not-finalized'
  | 'credit-note'
  | 'nothing-due'
  | 'offline-payment-method'
  | 'online-payments-off'
  | 'no-public-origin'
  | 'link-unavailable';

export type InvoicePaymentLinkResult =
  | { url: string }
  | { reason: InvoicePaymentLinkRefusalReason; message: string };

const REFUSAL_MESSAGES: Record<InvoicePaymentLinkRefusalReason, string> = {
  'invoice-not-found': 'This invoice could not be found.',
  'invoice-voided': 'This invoice has been voided, so it has no payment link.',
  'invoice-paid': 'This invoice is already paid, so it has no payment link.',
  'invoice-not-finalized': 'This invoice has not been finalized yet, so it has no payment link.',
  'credit-note': 'A credit note has nothing to pay, so it has no payment link.',
  'nothing-due': 'This invoice has no balance due, so it has no payment link.',
  'offline-payment-method': 'This invoice is billed by a method that is not paid online, so it has no payment link.',
  'online-payments-off': 'Online payments are not enabled for this account, so there is no payment link.',
  'link-unavailable': 'The payment link could not be created right now. Please try again.',
  'no-public-origin': 'No public web address is configured for the client portal, so a payment link cannot be built.',
};

function refuse(reason: InvoicePaymentLinkRefusalReason): InvoicePaymentLinkResult {
  return { reason, message: REFUSAL_MESSAGES[reason] };
}

/**
 * The durable `/pay/<token>` URL an invoice email would carry, for the MSP to
 * copy. Same eligibility predicates, URL builder, token type and tenant
 * lifetime as `getInvoiceEmailLinkContext`; an ineligible invoice gets a reason
 * and never a URL.
 */
export const getInvoicePaymentLinkAction = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
): Promise<InvoicePaymentLinkResult | { readonly permissionError: string }> => {
  // Handing out a payable link is what sending the invoice email does, so it
  // takes the same permission as sending.
  if (!await hasPermission(user, 'billing', 'create')) {
    return permissionError('Permission denied: billing create required', 'msp/billing:errors.permissions.billingCreate');
  }

  const { knex } = await createTenantKnex();
  const invoice = await tenantDb(knex, tenant).table('invoices')
    .where({ invoice_id: invoiceId })
    .first();
  if (!invoice) return refuse('invoice-not-found');

  const eligibilityFields = {
    invoice_id: invoice.invoice_id,
    status: invoice.status,
    finalized_at: invoice.finalized_at,
    invoice_type: invoice.invoice_type,
    total_amount: invoice.total_amount,
    credit_applied: invoice.credit_applied,
    payment_method: invoice.payment_method ?? null,
  };

  if (!isInvoiceLinkEligible(eligibilityFields)) {
    // Eligibility is decided above; the checks below only name the reason.
    const status = String(invoice.status ?? '').toLowerCase();
    if (status === 'cancelled') return refuse('invoice-voided');
    if (status === 'paid') return refuse('invoice-paid');
    if (invoice.invoice_type === 'credit_note') return refuse('credit-note');
    if (status === 'draft' || !invoice.finalized_at) return refuse('invoice-not-finalized');
    return refuse('nothing-due');
  }
  if (!isInvoiceOnlinePaymentAllowed(eligibilityFields)) return refuse('offline-payment-method');

  try {
    const paymentService = await getPaymentService(tenant);
    if (!paymentService || !(await paymentService.hasEnabledProvider())) {
      return refuse('online-payments-off');
    }
    const settings = await paymentService.getPaymentSettings();
    const url = await buildDurablePaymentUrl(tenant, invoice.invoice_id, settings.paymentLinkExpirationHours);
    return url ? { url } : refuse('no-public-origin');
  } catch (error) {
    logger.error('[invoicePaymentLinkActions] Failed to build payment link', { tenant, invoiceId, error });
    return refuse('link-unavailable');
  }
});
