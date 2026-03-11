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

/**
 * CE Stub - Not available in Community Edition
 */
export async function upgradeTierAction(
  _targetTier: 'pro' | 'premium',
  _interval: 'month' | 'year' = 'month'
): Promise<{ success: boolean; error?: string }> {
  logger.warn('[CE] upgradeTierAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Plan upgrades are only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getUpgradePreviewAction(
  _targetTier: 'pro' | 'premium',
  _interval: 'month' | 'year' = 'month'
): Promise<{
  success: boolean;
  error?: string;
  currentMonthly?: number;
  newBasePrice?: number;
  newUserPrice?: number;
  newMonthly?: number;
  userCount?: number;
  currency?: string;
  prorationAmount?: number;
  annualAvailable?: boolean;
  annualBasePrice?: number;
  annualUserPrice?: number;
  annualTotal?: number;
}> {
  logger.warn('[CE] getUpgradePreviewAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Plan upgrades are only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function switchBillingIntervalAction(
  _newInterval: 'month' | 'year'
): Promise<{ success: boolean; error?: string; effectiveDate?: string }> {
  logger.warn('[CE] switchBillingIntervalAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Billing interval switching is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function getIntervalSwitchPreviewAction(
  _newInterval: 'month' | 'year'
): Promise<{
  success: boolean;
  error?: string;
  currentInterval?: 'month' | 'year';
  currentTotal?: number;
  newTotal?: number;
  newBasePrice?: number;
  newUserPrice?: number;
  userCount?: number;
  effectiveDate?: string;
  savingsPercent?: number;
}> {
  logger.warn('[CE] getIntervalSwitchPreviewAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Billing interval switching is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function startPremiumTrialAction(
  _targetTenantId: string
): Promise<{ success: boolean; error?: string }> {
  logger.warn('[CE] startPremiumTrialAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Premium trials are only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function startSelfServicePremiumTrialAction(): Promise<{ success: boolean; error?: string }> {
  logger.warn('[CE] startSelfServicePremiumTrialAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Premium trials are only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function sendPremiumTrialRequestAction(
  _message: string
): Promise<{ success: boolean; error?: string }> {
  logger.warn('[CE] sendPremiumTrialRequestAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Premium trials are only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function confirmPremiumTrialAction(
  _interval: 'month' | 'year' = 'month'
): Promise<{ success: boolean; error?: string; effectiveDate?: string }> {
  logger.warn('[CE] confirmPremiumTrialAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Premium trials are only available in Enterprise Edition',
  };
}

/**
 * CE Stub - Not available in Community Edition
 */
export async function revertPremiumTrialAction(): Promise<{ success: boolean; error?: string }> {
  logger.warn('[CE] revertPremiumTrialAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'Premium trials are only available in Enterprise Edition',
  };
}

/**
 * CE Stub - getLicenseUsageAction
 */
export async function getLicenseUsageAction(): Promise<{
  success: boolean;
  data?: { active_licenses: number; total_licenses: number; price_per_license: number };
  error?: string;
}> {
  logger.warn('[CE] getLicenseUsageAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}

/**
 * CE Stub - sendCancellationFeedbackAction
 */
export async function sendCancellationFeedbackAction(
  _reasonText: string,
  _reasonCategory?: string
): Promise<{ success: boolean; error?: string }> {
  logger.warn('[CE] sendCancellationFeedbackAction called but Stripe integration is EE-only');
  return {
    success: false,
    error: 'This feature is only available in Enterprise Edition',
  };
}
