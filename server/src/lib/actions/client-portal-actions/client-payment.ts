'use server';

/**
 * Client Portal Payment Actions
 *
 * Server actions for client portal payment functionality.
 * These actions allow portal users to get payment links and verify payments.
 */

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getConnection } from 'server/src/lib/db/db';
import logger from '@alga-psa/shared/core/logger';

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

    // Verify the user has access to this invoice (via their company)
    const knex = await getConnection();
    const invoice = await knex('invoices')
      .where({
        tenant: user.tenant,
        invoice_id: invoiceId,
      })
      .first();

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    // Verify the invoice belongs to a company the user is associated with
    const userCompany = await knex('user_companies')
      .where({
        tenant: user.tenant,
        user_id: user.user_id,
        company_id: invoice.client_id,
      })
      .first();

    if (!userCompany) {
      return { success: false, error: 'Access denied' };
    }

    // Check if invoice is already paid
    if (invoice.status === 'paid') {
      return { success: false, error: 'already_paid' };
    }

    // Check if invoice is cancelled
    if (invoice.status === 'cancelled') {
      return { success: false, error: 'Invoice is cancelled' };
    }

    // Check if running Enterprise Edition
    const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
    if (!isEE) {
      return { success: false, error: 'payment_not_configured' };
    }

    // Dynamically import PaymentService (EE only)
    let PaymentService: any;
    try {
      const eeModule = await import('@ee/lib/payments');
      PaymentService = eeModule.PaymentService;
    } catch (error) {
      logger.debug('[ClientPayment] PaymentService not available');
      return { success: false, error: 'payment_not_configured' };
    }

    // Create PaymentService and get/create payment link
    const paymentService = await PaymentService.create(user.tenant);

    if (!await paymentService.hasEnabledProvider()) {
      return { success: false, error: 'payment_not_configured' };
    }

    const paymentLink = await paymentService.getOrCreatePaymentLink(invoiceId);
    if (!paymentLink) {
      return { success: false, error: 'Failed to create payment link' };
    }

    logger.info('[ClientPayment] Payment link retrieved', {
      tenantId: user.tenant,
      invoiceId,
      userId: user.user_id,
    });

    return {
      success: true,
      data: { paymentUrl: paymentLink.url },
    };
  } catch (error) {
    logger.error('[ClientPayment] Failed to get payment link', { error, invoiceId });
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
  message?: string;
}>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const knex = await getConnection();

    // Verify the user has access to this invoice
    const invoice = await knex('invoices')
      .where({
        tenant: user.tenant,
        invoice_id: invoiceId,
      })
      .first();

    if (!invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    // Verify user has access via company
    const userCompany = await knex('user_companies')
      .where({
        tenant: user.tenant,
        user_id: user.user_id,
        company_id: invoice.client_id,
      })
      .first();

    if (!userCompany) {
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
        },
      };
    }

    // Check if running Enterprise Edition
    const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
    if (!isEE) {
      return { success: false, error: 'Payment verification not available' };
    }

    // Verify the sessionId matches a payment link for this invoice
    // This ensures we're verifying the specific checkout session, not just any payment
    if (sessionId) {
      const paymentLink = await knex('invoice_payment_links')
        .where({
          tenant: user.tenant,
          invoice_id: invoiceId,
          external_link_id: sessionId,
        })
        .first();

      if (!paymentLink) {
        logger.warn('[ClientPayment] Session ID does not match any payment link for invoice', {
          tenantId: user.tenant,
          invoiceId,
          sessionId,
        });
        return { success: false, error: 'Invalid session' };
      }
    }

    // Dynamically import PaymentService (EE only)
    let PaymentService: any;
    try {
      const eeModule = await import('@ee/lib/payments');
      PaymentService = eeModule.PaymentService;
    } catch (error) {
      logger.debug('[ClientPayment] PaymentService not available');
      return { success: false, error: 'Payment verification not available' };
    }

    // Get payment status using the verified sessionId
    const paymentService = await PaymentService.create(user.tenant);
    const paymentDetails = await paymentService.getInvoicePaymentStatus(invoiceId);

    if (!paymentDetails) {
      // Payment might still be processing
      return {
        success: true,
        data: {
          status: 'pending',
          invoiceNumber: invoice.invoice_number,
          amount: invoice.total_amount,
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

    // Check if running Enterprise Edition
    const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
    if (!isEE) {
      return { success: true, data: { paymentUrl: null } };
    }

    // Dynamically import PaymentService
    let PaymentService: any;
    try {
      const eeModule = await import('@ee/lib/payments');
      PaymentService = eeModule.PaymentService;
    } catch (error) {
      return { success: true, data: { paymentUrl: null } };
    }

    const paymentService = await PaymentService.create(user.tenant);

    if (!await paymentService.hasEnabledProvider()) {
      return { success: true, data: { paymentUrl: null } };
    }

    const link = await paymentService.getActivePaymentLink(invoiceId);
    return {
      success: true,
      data: { paymentUrl: link?.url || null },
    };
  } catch (error) {
    logger.error('[ClientPayment] Failed to get active payment link', { error, invoiceId });
    return { success: true, data: { paymentUrl: null } };
  }
}
