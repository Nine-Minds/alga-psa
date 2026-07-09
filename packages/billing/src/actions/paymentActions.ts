'use server';

import logger from '@alga-psa/core/logger';
import type { PaymentDetails, PaymentLinkResult } from '@alga-psa/types';
import { getCurrentUserAsync } from '../lib/authHelpers';

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

async function getAuthenticatedTenantId(): Promise<string | null> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return null;
  }
  return currentUser.tenant;
}

export async function hasEnabledPaymentProvider(): Promise<boolean> {
  const tenantId = await getAuthenticatedTenantId();
  if (!tenantId) return false;
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
  invoiceId: string
): Promise<PaymentLinkResult | null> {
  const tenantId = await getAuthenticatedTenantId();
  if (!tenantId) return null;
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return null;

  const hasProvider = await paymentService.hasEnabledProvider();
  if (!hasProvider) return null;

  return paymentService.getOrCreatePaymentLink(invoiceId);
}

export async function getOrCreateInvoicePaymentLinkUrl(
  invoiceId: string
): Promise<string | null> {
  const link = await getOrCreateInvoicePaymentLink(invoiceId);
  return link?.url || null;
}

export async function getInvoicePaymentStatus(
  invoiceId: string
): Promise<PaymentDetails | null> {
  const tenantId = await getAuthenticatedTenantId();
  if (!tenantId) return null;
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return null;

  const hasProvider = await paymentService.hasEnabledProvider();
  if (!hasProvider) return null;

  return paymentService.getInvoicePaymentStatus(invoiceId);
}

export async function getActiveInvoicePaymentLinkUrl(
  invoiceId: string
): Promise<string | null> {
  const tenantId = await getAuthenticatedTenantId();
  if (!tenantId) return null;
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
