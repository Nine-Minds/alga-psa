'use server';

import logger from '@alga-psa/core/logger';
import type { PaymentDetails, PaymentLinkResult, WebhookProcessingResult } from '@alga-psa/types';

function isEnterpriseBuild(): boolean {
  return process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
}

async function loadEePayments(): Promise<{
  PaymentService: any;
  createStripePaymentProvider: any;
}> {
  const eeModule = await import('@ee/lib/payments');
  return {
    PaymentService: (eeModule as any).PaymentService,
    createStripePaymentProvider: (eeModule as any).createStripePaymentProvider,
  };
}

async function getPaymentService(tenantId: string): Promise<any | null> {
  if (!isEnterpriseBuild()) return null;

  try {
    const { PaymentService } = await loadEePayments();
    return PaymentService.create(tenantId);
  } catch (error) {
    logger.debug('[billing/paymentActions] PaymentService not available', { error });
    return null;
  }
}

export async function hasEnabledPaymentProvider(tenantId: string): Promise<boolean> {
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return false;

  try {
    return await paymentService.hasEnabledProvider();
  } catch (error) {
    logger.warn('[billing/paymentActions] hasEnabledProvider failed', { tenantId, error });
    return false;
  }
}

export async function getOrCreateInvoicePaymentLink(
  tenantId: string,
  invoiceId: string
): Promise<PaymentLinkResult | null> {
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return null;

  const hasProvider = await paymentService.hasEnabledProvider();
  if (!hasProvider) return null;

  return paymentService.getOrCreatePaymentLink(invoiceId);
}

export async function getOrCreateInvoicePaymentLinkUrl(
  tenantId: string,
  invoiceId: string
): Promise<string | null> {
  const link = await getOrCreateInvoicePaymentLink(tenantId, invoiceId);
  return link?.url || null;
}

export async function getInvoicePaymentStatus(
  tenantId: string,
  invoiceId: string
): Promise<PaymentDetails | null> {
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return null;

  const hasProvider = await paymentService.hasEnabledProvider();
  if (!hasProvider) return null;

  return paymentService.getInvoicePaymentStatus(invoiceId);
}

export async function getActiveInvoicePaymentLinkUrl(
  tenantId: string,
  invoiceId: string
): Promise<string | null> {
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return null;

  const hasProvider = await paymentService.hasEnabledProvider();
  if (!hasProvider) return null;

  const link = await paymentService.getActivePaymentLink(invoiceId);
  return link?.url || null;
}

export async function getInvoicePaymentLinkUrlForEmail(
  tenantId: string,
  invoiceId: string
): Promise<string | null> {
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return null;

  const hasProvider = await paymentService.hasEnabledProvider();
  if (!hasProvider) return null;

  const settings = await paymentService.getPaymentSettings();
  if (!settings?.paymentLinksInEmails) return null;

  const link = await paymentService.getOrCreatePaymentLink(invoiceId);
  return link?.url || null;
}

export async function processStripePaymentWebhookPayload(
  tenantId: string,
  payload: string
): Promise<WebhookProcessingResult> {
  if (!isEnterpriseBuild()) {
    return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
  }

  try {
    const { PaymentService, createStripePaymentProvider } = await loadEePayments();

    const paymentService = await PaymentService.create(tenantId);
    const provider = createStripePaymentProvider(tenantId);
    const webhookEvent = provider.parseWebhookEvent(payload);

    return paymentService.processWebhookEvent(webhookEvent);
  } catch (error) {
    logger.error('[billing/paymentActions] processStripePaymentWebhookPayload failed', { tenantId, error });
    return { success: false, error: 'Payment webhook processing failed' } as WebhookProcessingResult;
  }
}

