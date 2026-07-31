import { parseBigint, type BigintValue } from '../db/bigint.js';
import type { DeploymentType } from '../db/types.js';

export const ADMITTED_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type AdmissionDenialReason =
  | 'no_subscription'
  | 'out_of_credits'
  | 'consent_required';

export type AdmissionResult =
  | { allowed: true; availableCredits: bigint }
  | { allowed: false; reason: AdmissionDenialReason; availableCredits: bigint };

export interface AdmissionAccount {
  subscriptionStatus: string;
  deploymentType: DeploymentType;
  includedBalance: BigintValue;
  topupBalance: BigintValue;
  graceLimitCredits: BigintValue;
}

export interface AdmissionContext {
  hasActiveConsent?: boolean;
}

export function checkAdmission(
  account: AdmissionAccount,
  context: AdmissionContext = {},
): AdmissionResult {
  const includedBalance = parseBigint(account.includedBalance, 'account.includedBalance');
  const topupBalance = parseBigint(account.topupBalance, 'account.topupBalance');
  const graceLimitCredits = parseBigint(
    account.graceLimitCredits,
    'account.graceLimitCredits',
  );

  if (graceLimitCredits < 0n) {
    throw new Error('account.graceLimitCredits must be non-negative');
  }

  const availableCredits = includedBalance + topupBalance + graceLimitCredits;

  if (!ADMITTED_SUBSCRIPTION_STATUSES.has(account.subscriptionStatus)) {
    return { allowed: false, reason: 'no_subscription', availableCredits };
  }

  if (account.deploymentType === 'appliance' && context.hasActiveConsent !== true) {
    return { allowed: false, reason: 'consent_required', availableCredits };
  }

  if (availableCredits <= 0n) {
    return { allowed: false, reason: 'out_of_credits', availableCredits };
  }

  return { allowed: true, availableCredits };
}
