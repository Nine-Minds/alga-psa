'use client';

import React from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { useTier } from '@/context/TierContext';
import { TIER_LABELS } from '@alga-psa/types';

/**
 * Shows a trial countdown badge in the header when the tenant is on a trial.
 * - Neutral style when >3 days remaining
 * - Warning style when ≤3 days remaining
 * - Links to /msp/account
 */
export function TrialBanner() {
  const { isTrialing, trialDaysLeft, tier, isPaymentFailed } = useTier();

  // Don't show trial banner when payment has failed (PaymentFailedBanner takes priority)
  if (!isTrialing || isPaymentFailed) return null;

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
