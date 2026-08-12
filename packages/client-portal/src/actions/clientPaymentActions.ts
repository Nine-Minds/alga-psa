'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal payment actions intentionally orchestrate billing feature operations for customer payments. */

/**
 * Client Portal Payment Actions
 *
 * Server actions for client portal payment functionality.
 * These actions allow portal users to get payment links and verify payments.
 *
 * Failures return a stable, non-sensitive error code plus a safe display
 * message; the original server/provider exception is preserved in server logs
 * (including its native `cause`) and is never serialized to the browser.
 */

import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import {
  getActiveInvoicePaymentLinkUrl,
  getInvoicePaymentStatus,
  getOrCreateInvoicePaymentLinkUrl,
  expireInvoicePaymentLinksForTerminalStatus,
} from '@alga-psa/billing/actions/paymentActions';
import { PaymentLinkError } from '@alga-psa/billing/actions/paymentLinkError';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

export type ClientPaymentErrorCode =
  | 'contact_missing'
  | 'client_missing'
  | 'invoice_not_found'
  | 'access_denied'
  | 'invoice_unavailable'
  | 'already_paid'
  | 'invoice_cancelled'
  | 'no_amount_due'
  | 'payment_not_configured'
  | 'payment_link_creation_failed'
  | 'invalid_session';

export interface ClientPaymentActionError {
  /** Stable code the UI can reason about; never a provider message. */
  code: ClientPaymentErrorCode;
  /** Safe display message shown to the portal user. */
  message: string;
  /** Whether the user can retry from the failure screen. */
  retryable: boolean;
}

/**
 * Result of a payment action.
 */
export interface PaymentActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: ClientPaymentActionError;
}

function actionError<T = void>(
  code: ClientPaymentErrorCode,
  message: string,
  retryable = false
): PaymentActionResult<T> {
  return { success: false, error: { code, message, retryable } };
}

type InvoiceRecurringSummary = {
  service_period_start?: string | null;
  service_period_end?: string | null;
};

/**
 * Gets a payment link for an invoice in the client portal.
 * Creates a new payment link if one doesn't exist or has expired.
 */
export const getClientPortalInvoicePaymentLink = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  invoiceId: string
): Promise<PaymentActionResult<{ paymentUrl: string }>> => {
  try {
    // Client portal users must have a contact_id
    if (!user.contact_id) {
      return actionError('contact_missing', 'User not associated with a contact');
    }

    const tenantId = tenant;
    const { knex } = await createTenantKnex();

    // Get the user's client_id from their contact and verify invoice access
    const { contact, invoice } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenantId);

      const contactResult = await scopedDb.table('contacts')
        .where({
          contact_name_id: (user as any).contact_id,
        })
        .select('client_id')
        .first();

      const invoiceResult = await scopedDb.table('invoices')
        .where({
          invoice_id: invoiceId,
        })
        .first();

      return { contact: contactResult, invoice: invoiceResult };
    });

    if (!contact?.client_id) {
      return actionError('client_missing', 'Contact not associated with a client');
    }

    if (!invoice) {
      return actionError('invoice_not_found', 'Invoice not found');
    }

    // Verify the invoice belongs to the user's client
    if (invoice.client_id !== contact.client_id) {
      return actionError('access_denied', 'Access denied');
    }

    // Check if invoice is a draft or otherwise not finalized
    if (!invoice.finalized_at || invoice.status === 'draft') {
      return actionError('invoice_unavailable', 'Invoice not available for payment');
    }

    // Check if invoice is already paid
    if (invoice.status === 'paid') {
      // A Checkout session may still be live at the provider even though the
      // invoice is already settled (manual payment, credit application, ...).
      // Retire it before returning the stable outcome so the customer's old
      // payment link can never charge a paid invoice. Cleanup is best-effort:
      // a provider failure is logged and never changes the already_paid result.
      await expireInvoicePaymentLinksForTerminalStatus(tenantId, invoiceId, 'paid');
      return actionError('already_paid', 'This invoice has already been paid');
    }

    // Check if invoice is cancelled
    if (invoice.status === 'cancelled') {
      await expireInvoicePaymentLinksForTerminalStatus(tenantId, invoiceId, 'cancelled');
      return actionError('invoice_cancelled', 'Invoice is cancelled');
    }

    // Credit notes and fully-covered invoices carry no payable amount.
    const amountDue = Number(invoice.total_amount ?? 0) - Number(invoice.credit_applied ?? 0);
    if (invoice.invoice_type === 'credit_note' || amountDue <= 0) {
      return actionError('no_amount_due', 'Invoice has no amount due');
    }

    let paymentUrl: string | null;
    try {
      paymentUrl = await getOrCreateInvoicePaymentLinkUrl(invoiceId);
    } catch (error) {
      const code: ClientPaymentErrorCode =
        error instanceof PaymentLinkError ? error.code : 'payment_link_creation_failed';
      logger.error('[ClientPayment] Failed to get payment link', {
        error,
        invoiceId,
        tenantId,
      });
      return actionError(
        code,
        code === 'payment_not_configured'
          ? 'Online payment is not available for this invoice.'
          : 'We could not start the payment. Please try again.',
        code === 'payment_link_creation_failed'
      );
    }

    if (!paymentUrl) {
      return actionError(
        'payment_not_configured',
        'Online payment is not available for this invoice.'
      );
    }

    logger.info('[ClientPayment] Payment link retrieved', {
      tenantId,
      invoiceId,
      userId: user.user_id,
    });

    return {
      success: true,
      data: { paymentUrl },
    };
  } catch (error) {
    logger.error('[ClientPayment] Failed to get payment link', {
      error,
      invoiceId,
    });
    return actionError(
      'payment_link_creation_failed',
      'We could not start the payment. Please try again.',
      true
    );
  }
});

/**
 * Verifies a payment after returning from Stripe Checkout.
 * Used on the payment success page to confirm payment status.
 */
export const verifyClientPortalPayment = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  invoiceId: string,
  sessionId: string
): Promise<
  PaymentActionResult<{
    status: 'succeeded' | 'pending' | 'processing' | 'failed';
    invoiceNumber?: string;
    amount?: number;
    currencyCode?: string;
    servicePeriodStart?: string | null;
    servicePeriodEnd?: string | null;
    message?: string;
  }>
> => {
  try {
    // Client portal users must have a contact_id
    if (!user.contact_id) {
      return actionError('contact_missing', 'User not associated with a contact');
    }

    const tenantId = tenant;
    const { knex } = await createTenantKnex();

    // Get the user's client_id from their contact and verify invoice access
    const { contact, invoice, recurringSummary } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenantId);

      const contactResult = await scopedDb.table('contacts')
        .where({
          contact_name_id: (user as any).contact_id,
        })
        .select('client_id')
        .first();

      const invoiceResult = await scopedDb.table('invoices')
        .where({
          invoice_id: invoiceId,
        })
        .first();

      let recurringSummaryResult: InvoiceRecurringSummary | null = null;
      if (invoiceResult) {
        const recurringSummaryQuery = scopedDb.table('invoice_charges as ic')
          .where({
            'ic.invoice_id': invoiceId,
          });
        scopedDb.tenantJoin(recurringSummaryQuery, 'invoice_charge_details as iid', 'ic.item_id', 'iid.item_id');
        recurringSummaryResult = await recurringSummaryQuery
          .select(
            trx.raw('MIN(iid.service_period_start) as service_period_start'),
            trx.raw('MAX(iid.service_period_end) as service_period_end')
          )
          .first() as InvoiceRecurringSummary | null;
      }

      return { contact: contactResult, invoice: invoiceResult, recurringSummary: recurringSummaryResult };
    });

    if (!contact?.client_id) {
      return actionError('client_missing', 'Contact not associated with a client');
    }

    if (!invoice) {
      return actionError('invoice_not_found', 'Invoice not found');
    }

    // Verify user has access via their client
    if (invoice.client_id !== contact.client_id) {
      return actionError('access_denied', 'Access denied');
    }

    // Check if invoice is already marked as paid
    if (invoice.status === 'paid') {
      return {
        success: true,
        data: {
          status: 'succeeded',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount - (invoice.credit_applied ?? 0),
          currencyCode: invoice.currency_code || 'USD',
          servicePeriodStart: recurringSummary?.service_period_start ?? null,
          servicePeriodEnd: recurringSummary?.service_period_end ?? null,
        },
      };
    }

    // Verify the sessionId matches a payment link for this invoice
    // This ensures we're verifying the specific checkout session, not just any payment
    if (sessionId) {
      const paymentLink = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return tenantDb(trx, tenantId).table('invoice_payment_links')
          .where({
            invoice_id: invoiceId,
            external_link_id: sessionId,
          })
          .first();
      });

      if (!paymentLink) {
        logger.warn('[ClientPayment] Session ID does not match any payment link for invoice', {
          tenantId,
          invoiceId,
          sessionId,
        });
        return actionError('invalid_session', 'Invalid session');
      }
    }

    // Check payment status from the payment provider
    const paymentStatus = await getInvoicePaymentStatus(invoiceId);

    // Get the most current payment URL (if needed for retry)
    const paymentUrl = await getActiveInvoicePaymentLinkUrl(invoiceId);

    if (!paymentStatus) {
      return {
        success: true,
        data: {
          status: paymentUrl ? 'pending' : 'failed',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount - (invoice.credit_applied ?? 0),
          currencyCode: invoice.currency_code || 'USD',
          servicePeriodStart: recurringSummary?.service_period_start ?? null,
          servicePeriodEnd: recurringSummary?.service_period_end ?? null,
          message: paymentUrl ? 'pending' : 'payment_not_configured',
        },
      };
    }

    // Map payment status to client-friendly status
    if (paymentStatus.status === 'succeeded') {
      return {
        success: true,
        data: {
          status: 'succeeded',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount - (invoice.credit_applied ?? 0),
          currencyCode: invoice.currency_code || 'USD',
          servicePeriodStart: recurringSummary?.service_period_start ?? null,
          servicePeriodEnd: recurringSummary?.service_period_end ?? null,
        },
      };
    }

    if (paymentStatus.status === 'processing') {
      return {
        success: true,
        data: {
          status: 'processing',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount - (invoice.credit_applied ?? 0),
          currencyCode: invoice.currency_code || 'USD',
          servicePeriodStart: recurringSummary?.service_period_start ?? null,
          servicePeriodEnd: recurringSummary?.service_period_end ?? null,
          message: 'processing',
        },
      };
    }

    if (paymentStatus.status === 'pending' || paymentStatus.status === 'requires_action') {
      return {
        success: true,
        data: {
          status: 'pending',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount - (invoice.credit_applied ?? 0),
          currencyCode: invoice.currency_code || 'USD',
          servicePeriodStart: recurringSummary?.service_period_start ?? null,
          servicePeriodEnd: recurringSummary?.service_period_end ?? null,
          message: paymentStatus.status,
        },
      };
    }

    return {
      success: true,
      data: {
        status: 'failed',
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total_amount - (invoice.credit_applied ?? 0),
        currencyCode: invoice.currency_code || 'USD',
        servicePeriodStart: recurringSummary?.service_period_start ?? null,
        servicePeriodEnd: recurringSummary?.service_period_end ?? null,
        message: paymentUrl ? paymentStatus.status : 'payment_not_configured',
      },
    };
  } catch (error) {
    logger.error('[ClientPayment] Failed to verify payment', {
      error,
      invoiceId,
      sessionId,
    });
    return actionError(
      'payment_link_creation_failed',
      'We could not verify your payment. Please try again.',
      true
    );
  }
});
