/**
 * CE Stub for Stripe-related license actions
 * These are imported from EE in EE builds, but stubbed in CE builds
 */
'use server';

import logger from '@alga-psa/shared/core/logger';

/**
 * CE Stub - Not available in Community Edition
 */
export async function getInvoicePreviewAction(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] getInvoicePreviewAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition. Self-hosted Community Edition has unlimited users.',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function createLicenseCheckoutSessionAction(): Promise<{
  success: boolean;
  error: string;
}> {
  logger.warn('[CE] createLicenseCheckoutSessionAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'License purchasing is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getLicensePricingAction(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] getLicensePricingAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getSubscriptionInfoAction(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] getSubscriptionInfoAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getPaymentMethodInfoAction(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] getPaymentMethodInfoAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getRecentInvoicesAction(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] getRecentInvoicesAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function createCustomerPortalSessionAction(): Promise<{
  success: boolean;
  error: string;
}> {
  logger.warn('[CE] createCustomerPortalSessionAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function cancelSubscriptionAction(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] cancelSubscriptionAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function reduceLicenseCount(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] reduceLicenseCount called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function reduceLicenseCountAction(): Promise<{ success: boolean; error: string }> {
  logger.warn('[CE] reduceLicenseCountAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getScheduledLicenseChangesAction(): Promise<{
  success: boolean;
  error: string;
}> {
  logger.warn('[CE] getScheduledLicenseChangesAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}
