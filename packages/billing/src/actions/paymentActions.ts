'use server';

import logger from '@alga-psa/core/logger';
import type { PaymentDetails, PaymentLinkResult, WebhookProcessingResult } from '@alga-psa/types';

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
    logger.debug('[billing/paymentActions] enterprise payments module not available', { error });
    return null;
  }
}

async function getPaymentService(tenantId: string): Promise<any | null> {
  if (!isEnterpriseBuild()) return null;

  try {
    const ee = await loadEnterprisePayments();
    if (!ee?.PaymentService) return null;
    return await ee.PaymentService.create(tenantId);
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
    const ee = await loadEnterprisePayments();
    if (!ee?.PaymentService || !ee?.createStripePaymentProvider) {
      return { success: false, error: 'Payment integration not available' } as WebhookProcessingResult;
    }

    const paymentService = await ee.PaymentService.create(tenantId);
    const provider = ee.createStripePaymentProvider(tenantId);
    const webhookEvent = provider.parseWebhookEvent(payload);

    return paymentService.processWebhookEvent(webhookEvent);
  } catch (error) {
    logger.error('[billing/paymentActions] processStripePaymentWebhookPayload failed', { tenantId, error });
    return { success: false, error: 'Payment webhook processing failed' } as WebhookProcessingResult;
  }
}
