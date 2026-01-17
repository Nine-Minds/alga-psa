'use server';

/**
 * Client Portal Payment Actions
 *
 * Server actions for client portal payment functionality.
 * These actions allow portal users to get payment links and verify payments.
 */

import { withTransaction, createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import {
  getActiveInvoicePaymentLinkUrl,
  getInvoicePaymentStatus,
  getOrCreateInvoicePaymentLinkUrl,
} from '@alga-psa/billing/actions/paymentActions';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

/**
 * Result of a payment action.
 */
interface PaymentActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Gets a payment link for an invoice in the client portal.
 * Creates a new payment link if one doesn't exist or has expired.
 */
export async function getClientPortalInvoicePaymentLink(
  invoiceId: string
): Promise<PaymentActionResult<{ paymentUrl: string }>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    // Client portal users must have a contact_id
    if (!(user as any).contact_id) {
      return { success: false, error: 'User not associated with a contact' };
    }

    const tenantId = user.tenant;
    const { knex } = await createTenantKnex(tenantId);

    // Get the user's client_id from their contact and verify invoice access
    const { contact, invoice } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const contactResult = await trx('contacts')
        .where({
          tenant: tenantId,
          contact_name_id: (user as any).contact_id,
        })
        .select('client_id')
        .first();

      const invoiceResult = await trx('invoices')
        .where({
          tenant: tenantId,
          invoice_id: invoiceId,
        })
        .first();

      return { contact: contactResult, invoice: invoiceResult };
    });

    if (!contact?.client_id) {
      return { success: false, error: 'Contact not associated with a client' };
    }

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    // Verify the invoice belongs to the user's client
    if (invoice.client_id !== contact.client_id) {
      return { success: false, error: 'Access denied' };
    }

    // Check if invoice is a draft (not finalized)
    if (invoice.status === 'draft') {
      return { success: false, error: 'Invoice not available' };
    }

    // Check if invoice is already paid
    if (invoice.status === 'paid') {
      return { success: false, error: 'already_paid' };
    }

    // Check if invoice is cancelled
    if (invoice.status === 'cancelled') {
      return { success: false, error: 'Invoice is cancelled' };
    }

    const paymentUrl = await getOrCreateInvoicePaymentLinkUrl(tenantId, invoiceId);
    if (!paymentUrl) {
      return { success: false, error: 'payment_not_configured' };
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('[ClientPayment] Failed to get payment link', {
      errorMessage,
      errorStack,
      invoiceId,
    });
    return { success: false, error: 'Failed to get payment link' };
  }
}

/**
 * Verifies a payment after returning from Stripe Checkout.
 * Used on the payment success page to confirm payment status.
 */
export async function verifyClientPortalPayment(
  invoiceId: string,
  sessionId: string
): Promise<
  PaymentActionResult<{
    status: 'succeeded' | 'pending' | 'processing' | 'failed';
    invoiceNumber?: string;
    amount?: number;
    currencyCode?: string;
    message?: string;
  }>
> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    // Client portal users must have a contact_id
    if (!(user as any).contact_id) {
      return { success: false, error: 'User not associated with a contact' };
    }

    const tenantId = user.tenant;
    const { knex } = await createTenantKnex(tenantId);

    // Get the user's client_id from their contact and verify invoice access
    const { contact, invoice } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const contactResult = await trx('contacts')
        .where({
          tenant: tenantId,
          contact_name_id: (user as any).contact_id,
        })
        .select('client_id')
        .first();

      const invoiceResult = await trx('invoices')
        .where({
          tenant: tenantId,
          invoice_id: invoiceId,
        })
        .first();

      return { contact: contactResult, invoice: invoiceResult };
    });

    if (!contact?.client_id) {
      return { success: false, error: 'Contact not associated with a client' };
    }

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    // Verify user has access via their client
    if (invoice.client_id !== contact.client_id) {
      return { success: false, error: 'Access denied' };
    }

    // Check if invoice is already marked as paid
    if (invoice.status === 'paid') {
      return {
        success: true,
        data: {
          status: 'succeeded',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
          currencyCode: invoice.currency_code || 'USD',
        },
      };
    }

    // Verify the sessionId matches a payment link for this invoice
    // This ensures we're verifying the specific checkout session, not just any payment
    if (sessionId) {
      const paymentLink = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return trx('invoice_payment_links')
          .where({
            tenant: tenantId,
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
        return { success: false, error: 'Invalid session' };
      }
    }

    // Check payment status from the payment provider
    const paymentStatus = await getInvoicePaymentStatus(tenantId, invoiceId);

    // Get the most current payment URL (if needed for retry)
    const paymentUrl = await getActiveInvoicePaymentLinkUrl(tenantId, invoiceId);

    if (!paymentStatus) {
      return {
        success: true,
        data: {
          status: paymentUrl ? 'pending' : 'failed',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
          currencyCode: invoice.currency_code || 'USD',
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
          amount: invoice.total_amount,
          currencyCode: invoice.currency_code || 'USD',
        },
      };
    }

    if (paymentStatus.status === 'processing') {
      return {
        success: true,
        data: {
          status: 'processing',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
          currencyCode: invoice.currency_code || 'USD',
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
          amount: invoice.total_amount,
          currencyCode: invoice.currency_code || 'USD',
          message: paymentStatus.status,
        },
      };
    }

    return {
      success: true,
      data: {
        status: 'failed',
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total_amount,
        currencyCode: invoice.currency_code || 'USD',
        message: paymentUrl ? paymentStatus.status : 'payment_not_configured',
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('[ClientPayment] Failed to verify payment', {
      errorMessage,
      errorStack,
      invoiceId,
      sessionId,
    });
    return { success: false, error: 'Failed to verify payment' };
  }
}
