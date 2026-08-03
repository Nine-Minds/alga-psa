'use client';

import React from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { useTier } from '@/context/TierContext';
import { TIER_LABELS } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Shows a trial countdown badge in the header when the tenant is on a trial.
 * - Neutral style when >3 days remaining
 * - Warning style when ≤3 days remaining
 * - Links to /msp/account
 *
 * Handles the Stripe Pro trial, which auto-charges after the trial.
 */
export function TrialBanner() {
  const { t } = useTranslation('msp/core');
  const { isTrialing, trialDaysLeft, tier, isPaymentFailed } = useTier();

  // Don't show trial banner when payment has failed (PaymentFailedBanner takes priority)
  if (isPaymentFailed) return null;

  // Stripe trial banner (7-day, auto-charges)
  if (!isTrialing) return null;

  const isUrgent = trialDaysLeft <= 3;
  const daysLabel =
    trialDaysLeft === 1
      ? t('banners.trial.dayLeft', { defaultValue: '1 day left' })
      : t('banners.trial.daysLeft', {
          defaultValue: '{{count}} days left',
          count: trialDaysLeft,
        });

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
      <span>
        {t('banners.trial.stripeTrial', {
          defaultValue: '{{tier}} Trial: {{daysLabel}}',
          tier: TIER_LABELS[tier],
          daysLabel,
        })}
      </span>
    </Link>
  );
}
