/**
 * Payment webhook helpers — NOT a Next.js server action module.
 *
 * WARNING: processStripePaymentWebhookPayload is a webhook receiver and must be
 * called from a verified webhook handler only, never as a Next.js server action.
 * This function intentionally lives outside any 'use server' file so it cannot
 * be accidentally exposed as a callable server action.
 */

import logger from '@alga-psa/core/logger';
import type { WebhookProcessingResult } from '@alga-psa/types';

function isEnterpriseBuild(): boolean {
  return process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
}

async function loadEnterprisePayments(): Promise<{
  PaymentService: any;
  createStripePaymentProvider: any;
} | null> {
  try {
    const mod = await import('@enterprise/lib/payments');
    return {
      PaymentService: (mod as any).PaymentService,
      createStripePaymentProvider: (mod as any).createStripePaymentProvider,
    };
  } catch (error) {
    logger.debug('[billing/paymentWebhookHelpers] enterprise payments module not available', { error });
    return null;
  }
}

/**
 * Process a verified Stripe webhook payload.
 *
 * This function MUST only be called from a webhook route handler that has already
 * verified the Stripe-Signature header. It must never be exposed as a server action.
 */
export async function processStripePaymentWebhookPayload(
  tenantId: string,
  payload: string
): Promise<WebhookProcessingResult> {
  if (!isEnterpriseBuild()) {
    return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
  }

  try {
    const ee = await loadEnterprisePayments();
    if (!ee?.PaymentService || !ee?.createStripePaymentProvider) {
      return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
    }

    const paymentService = await ee.PaymentService.create(tenantId);
    const provider = ee.createStripePaymentProvider(tenantId);
    const webhookEvent = provider.parseWebhookEvent(payload);

    return paymentService.processWebhookEvent(webhookEvent);
  } catch (error) {
    logger.error('[billing/paymentWebhookHelpers] processStripePaymentWebhookPayload failed', { tenantId, error });
    return { success: false, error: 'Payment webhook processing failed' } as WebhookProcessingResult;
  }
}
