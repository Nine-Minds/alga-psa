'use server';

import logger from '@alga-psa/core/logger';
import type { PaymentDetails, PaymentLinkResult } from '@alga-psa/types';
import { getCurrentUserAsync } from '../lib/authHelpers';
import { PaymentLinkError } from './paymentLinkError';

export type { PaymentLinkErrorCode } from './paymentLinkError';

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
    if (isEnterpriseBuild()) {
      throw new PaymentLinkError(
        'payment_link_creation_failed',
        'Enterprise payments module failed to load',
        { cause: error }
      );
    }
    logger.debug('[billing/paymentActions] enterprise payments module not available', { error });
    return null;
  }
}

export async function getPaymentService(tenantId: string): Promise<any | null> {
  if (!isEnterpriseBuild()) return null;

  try {
    const ee = await loadEnterprisePayments();
    if (!ee?.PaymentService) return null;
    return await ee.PaymentService.create(tenantId);
  } catch (error) {
    if (error instanceof PaymentLinkError) {
      throw error;
    }
    logger.error('[billing/paymentActions] PaymentService initialization failed', { tenantId, error });
    throw new PaymentLinkError(
      'payment_link_creation_failed',
      'Payment service failed to initialize',
      { cause: error }
    );
  }
}

/**
 * Runs a payment-service call through the billing action boundary. Any
 * non-`PaymentLinkError` failure (provider, link-creation, or status) is
 * rethrown as a `PaymentLinkError` with the original exception preserved as
 * `cause` for server logs and tests; existing `PaymentLinkError`s pass through
 * untouched. The cause is never serialized to the browser.
 */
async function runPaymentServiceCall(operation: string, fn: () => Promise<any>): Promise<any> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PaymentLinkError) {
      throw error;
    }
    logger.error(`[billing/paymentActions] ${operation}`, { error });
    throw new PaymentLinkError('payment_link_creation_failed', operation, { cause: error });
  }
}

/**
 * Returns the payment service when a provider is enabled for the tenant,
 * or null when payments are intentionally absent (CE build or no enabled
 * provider). EE initialization/link-creation failures surface as a
 * `PaymentLinkError` with the original cause preserved.
 */
async function getConfiguredPaymentService(tenantId: string): Promise<{ service: any } | null> {
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return null;

  const hasProvider = await runPaymentServiceCall('Failed to check payment provider', () =>
    paymentService.hasEnabledProvider()
  );
  if (!hasProvider) return null;

  return { service: paymentService };
}

async function getAuthenticatedTenantId(): Promise<string | null> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return null;
  }
  return currentUser.tenant;
}

// LEVERAGE: friction enabled-provider-resolution — hasEnabledPaymentProvider duplicates the
// getConfiguredPaymentService flow (tenant -> service -> provider-check); delegate to it.
export async function hasEnabledPaymentProvider(): Promise<boolean> {
  const tenantId = await getAuthenticatedTenantId();
  if (!tenantId) return false;
  const paymentService = await getPaymentService(tenantId);
  if (!paymentService) return false;

  return runPaymentServiceCall('Failed to check payment provider', () =>
    paymentService.hasEnabledProvider()
  );
}

export async function getOrCreateInvoicePaymentLink(
  invoiceId: string
): Promise<PaymentLinkResult | null> {
  const tenantId = await getAuthenticatedTenantId();
  if (!tenantId) return null;
  const configured = await getConfiguredPaymentService(tenantId);
  if (!configured) return null;

  return runPaymentServiceCall('Failed to create payment link', () =>
    configured.service.getOrCreatePaymentLink(invoiceId)
  );
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
  const configured = await getConfiguredPaymentService(tenantId);
  if (!configured) return null;

  return runPaymentServiceCall('Failed to get payment status', () =>
    configured.service.getInvoicePaymentStatus(invoiceId)
  );
}

export async function getActiveInvoicePaymentLinkUrl(
  invoiceId: string
): Promise<string | null> {
  const tenantId = await getAuthenticatedTenantId();
  if (!tenantId) return null;
  const configured = await getConfiguredPaymentService(tenantId);
  if (!configured) return null;

  const link = await runPaymentServiceCall('Failed to get active payment link', () =>
    configured.service.getActivePaymentLink(invoiceId)
  );
  return link?.url || null;
}

export async function getInvoicePaymentLinkUrlForEmail(
  tenantId: string,
  invoiceId: string
): Promise<string | null> {
  const configured = await getConfiguredPaymentService(tenantId);
  if (!configured) return null;

  const settings = await runPaymentServiceCall('Failed to get payment settings', () =>
    configured.service.getPaymentSettings()
  );
  if (!settings?.paymentLinksInEmails) return null;

  const link = await runPaymentServiceCall('Failed to create payment link', () =>
    configured.service.getOrCreatePaymentLink(invoiceId)
  );
  return link?.url || null;
}
