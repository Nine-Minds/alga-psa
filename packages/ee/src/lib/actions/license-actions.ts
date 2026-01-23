/**
 * CE Stub for Stripe-related license actions
 * These are imported from EE in EE builds, but stubbed in CE builds
 */
'use server';

import logger from '@alga-psa/core/logger';
import type {
  ICancelSubscriptionResponse,
  IGetInvoicesResponse,
  IGetPaymentMethodResponse,
  IGetSubscriptionInfoResponse,
  IScheduledLicenseChange,
} from '@alga-psa/types';

/**
 * CE Stub - Not available in Community Edition
 */
export async function getInvoicePreviewAction(
  _quantity: number,
): Promise<{
  success: boolean;
  data?: {
    currentQuantity: number;
    newQuantity: number;
    isIncrease: boolean;
    amountDue: number;
    currency: string;
    currentPeriodEnd: string;
    prorationAmount: number;
    remainingAmount: number;
  };
  error?: string;
}> {
  logger.warn('[CE] getInvoicePreviewAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition. Self-hosted Community Edition has unlimited users.',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function createLicenseCheckoutSessionAction(
  _quantity: number,
): Promise<{
  success: boolean;
  data?: {
    type: 'checkout' | 'updated';
    clientSecret?: string;
    sessionId?: string;
    publishableKey?: string;
    scheduledChange?: boolean;
  };
  error?: string;
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
export async function getLicensePricingAction(): Promise<{
  success: boolean;
  data?: {
    priceId: string;
    unitAmount: number;
    currency: string;
    interval: string;
  };
  error?: string;
}> {
  logger.warn('[CE] getLicensePricingAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getSubscriptionInfoAction(): Promise<IGetSubscriptionInfoResponse> {
  logger.warn('[CE] getSubscriptionInfoAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getPaymentMethodInfoAction(): Promise<IGetPaymentMethodResponse> {
  logger.warn('[CE] getPaymentMethodInfoAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getRecentInvoicesAction(): Promise<IGetInvoicesResponse> {
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
  data?: {
    portal_url: string;
  };
  error?: string;
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
export async function cancelSubscriptionAction(): Promise<ICancelSubscriptionResponse> {
  logger.warn('[CE] cancelSubscriptionAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function reduceLicenseCount(
  _tenantId: string,
  _newQuantity: number,
): Promise<{
  success: boolean;
  data?: {
    scheduledChange: boolean;
    effectiveDate: string;
    currentQuantity: number;
    newQuantity: number;
  };
  error?: string;
}> {
  logger.warn('[CE] reduceLicenseCount called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function reduceLicenseCountAction(
  _newQuantity: number,
): Promise<{
  success: boolean;
  data?: {
    scheduledChange: boolean;
    effectiveDate: string;
    currentQuantity: number;
    newQuantity: number;
    creditAmount?: number;
    currency?: string;
  };
  error?: string;
  needsDeactivation?: boolean;
  activeUserCount?: number;
  requestedQuantity?: number;
}> {
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
  data?: IScheduledLicenseChange | null;
  error?: string;
}> {
  logger.warn('[CE] getScheduledLicenseChangesAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}
