'use client';

import React from 'react';
import Link from 'next/link';
import { Clock, CheckCircle } from 'lucide-react';
import { useTier } from '@/context/TierContext';
import { TIER_LABELS } from '@alga-psa/types';

/**
 * Shows a trial countdown badge in the header when the tenant is on a trial.
 * - Neutral style when >3 days remaining
 * - Warning style when ≤3 days remaining
 * - Links to /msp/account
 *
 * Handles two types of trials:
 * 1. Stripe trial (7-day Pro trial) — auto-charges after trial
 * 2. Premium trial (30-day) — reverts to Pro unless user confirms
 */
export function TrialBanner() {
  const { isTrialing, trialDaysLeft, tier, isPaymentFailed, isPremiumTrial, premiumTrialDaysLeft, isPremiumTrialConfirmed } = useTier();

  // Don't show trial banner when payment has failed (PaymentFailedBanner takes priority)
  if (isPaymentFailed) return null;

  // Premium trial banner (30-day, no auto-charge)
  if (isPremiumTrial) {
    if (isPremiumTrialConfirmed) {
      // Confirmed — green badge, no urgency
      return (
        <Link
          href="/msp/account"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700"
        >
          <CheckCircle className="h-3 w-3" />
          <span>Premium confirmed — starts next billing cycle</span>
        </Link>
      );
    }

    const isUrgent = premiumTrialDaysLeft <= 3;
    const daysLabel = premiumTrialDaysLeft === 1 ? '1 day left' : `${premiumTrialDaysLeft} days left`;

    return (
      <Link
        href="/msp/account"
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          isUrgent
            ? 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
            : 'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
        }`}
      >
        <Clock className="h-3 w-3" />
        <span>Premium Trial: {daysLabel} — confirm to keep</span>
      </Link>
    );
  }

  // Stripe trial banner (7-day, auto-charges)
  if (!isTrialing) return null;

  const isUrgent = trialDaysLeft <= 3;
  const daysLabel = trialDaysLeft === 1 ? '1 day left' : `${trialDaysLeft} days left`;

  return (
    <Link
      href="/msp/account"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        isUrgent
          ? 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
          : 'bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
      }`}
    >
      <Clock className="h-3 w-3" />
      <span>{TIER_LABELS[tier]} Trial: {daysLabel}</span>
    </Link>
  );
}
