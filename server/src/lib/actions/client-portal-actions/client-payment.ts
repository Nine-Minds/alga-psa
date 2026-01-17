'use server';

/**
 * Client Portal Payment Actions
 *
 * Server actions for client portal payment functionality.
 * These actions allow portal users to get payment links and verify payments.
 */

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getConnection } from 'server/src/lib/db/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import {
  getActiveInvoicePaymentLinkUrl,
  getInvoicePaymentStatus,
  getOrCreateInvoicePaymentLinkUrl,
} from '@alga-psa/billing/actions/paymentActions';

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

    const knex = await getConnection(user.tenant);

    // Get the user's client_id from their contact and verify invoice access
    const { contact, invoice } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const contactResult = await trx('contacts')
        .where({
          tenant: user.tenant,
          contact_name_id: (user as any).contact_id,
        })
        .select('client_id')
        .first();

      const invoiceResult = await trx('invoices')
        .where({
          tenant: user.tenant,
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

    const paymentUrl = await getOrCreateInvoicePaymentLinkUrl(user.tenant, invoiceId);
    if (!paymentUrl) {
      return { success: false, error: 'payment_not_configured' };
    }

    logger.info('[ClientPayment] Payment link retrieved', {
      tenantId: user.tenant,
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
      invoiceId
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
): Promise<PaymentActionResult<{
  status: 'succeeded' | 'pending' | 'processing' | 'failed';
  invoiceNumber?: string;
  amount?: number;
  currencyCode?: string;
  message?: string;
}>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    // Client portal users must have a contact_id
    if (!(user as any).contact_id) {
      return { success: false, error: 'User not associated with a contact' };
    }

    const knex = await getConnection(user.tenant);

    // Get the user's client_id from their contact and verify invoice access
    const { contact, invoice } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const contactResult = await trx('contacts')
        .where({
          tenant: user.tenant,
          contact_name_id: (user as any).contact_id,
        })
        .select('client_id')
        .first();

      const invoiceResult = await trx('invoices')
        .where({
          tenant: user.tenant,
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
        return await trx('invoice_payment_links')
          .where({
            tenant: user.tenant,
            invoice_id: invoiceId,
            external_link_id: sessionId,
          })
          .first();
      });

      if (!paymentLink) {
        logger.warn('[ClientPayment] Session ID does not match any payment link for invoice', {
          tenantId: user.tenant,
          invoiceId,
          sessionId,
        });
        return { success: false, error: 'Invalid session' };
      }
    }

    const paymentDetails = await getInvoicePaymentStatus(user.tenant, invoiceId);

    if (!paymentDetails) {
      // Payment might still be processing
      return {
        success: true,
        data: {
          status: 'pending',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
          currencyCode: invoice.currency_code || 'USD',
          message: 'Payment is being processed',
        },
      };
    }

    // Map payment status
    let status: 'succeeded' | 'pending' | 'processing' | 'failed';
    switch (paymentDetails.status) {
      case 'succeeded':
        status = 'succeeded';
        break;
      case 'processing':
        status = 'processing';
        break;
      case 'pending':
      case 'requires_action':
        status = 'pending';
        break;
      default:
        status = 'failed';
    }

    logger.info('[ClientPayment] Payment verified', {
      tenantId: user.tenant,
      invoiceId,
      status,
      userId: user.user_id,
    });

    return {
      success: true,
      data: {
        status,
        invoiceNumber: invoice.invoice_number,
        amount: paymentDetails.amount || invoice.total_amount,
        currencyCode: invoice.currency_code || 'USD',
      },
    };
  } catch (error) {
    logger.error('[ClientPayment] Failed to verify payment', { error, invoiceId });
    return { success: false, error: 'Failed to verify payment' };
  }
}

/**
 * Gets the active payment link URL for an invoice (if one exists).
 * Used to display a "Pay Now" button on invoice details.
 */
export async function getActivePaymentLinkUrl(
  invoiceId: string
): Promise<PaymentActionResult<{ paymentUrl: string | null }>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const paymentUrl = await getActiveInvoicePaymentLinkUrl(user.tenant, invoiceId);
    return {
      success: true,
      data: { paymentUrl },
    };
  } catch (error) {
    logger.error('[ClientPayment] Failed to get active payment link', { error, invoiceId });
    return { success: true, data: { paymentUrl: null } };
  }
}
