'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { WelcomeBanner } from '@alga-psa/ui/components/WelcomeBanner';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { IQueueFoundTotal } from '@alga-psa/types';

/**
 * The queue header. The greeting itself is the shared home-page banner — one
 * "Good morning" in the product — and the stakes (found money, per currency)
 * ride along as its description.
 */
export function QueueGreeting({
  firstName,
  actionCount,
  quietCount,
  foundTotals,
}: {
  firstName: string;
  actionCount: number;
  quietCount: number;
  /** One entry per currency — found money is never summed across currencies. */
  foundTotals: IQueueFoundTotal[];
}) {
  const { t } = useTranslation('msp/opportunities');
  const needsYou = actionCount + quietCount;

  const stakes = foundTotals
    .map((total) => {
      const mrr = total.mrr_cents > 0
        ? formatCurrencyFromMinorUnits(total.mrr_cents, undefined, total.currency_code)
        : null;
      const nrr = total.nrr_cents > 0
        ? formatCurrencyFromMinorUnits(total.nrr_cents, undefined, total.currency_code)
        : null;
      if (mrr && nrr) {
        return t(
          'opportunities.queue.stakesBoth',
          '{{mrr}}/mo of recurring work and {{nrr}} of project work are already visible in your own data.',
          { mrr, nrr }
        );
      }
      if (mrr) {
        return t(
          'opportunities.queue.stakesMrr',
          '{{amount}}/mo of recurring work is already visible in your own data.',
          { amount: mrr }
        );
      }
      if (nrr) {
        return t(
          'opportunities.queue.stakesNrr',
          '{{amount}} of project work is already visible in your own data.',
          { amount: nrr }
        );
      }
      return null;
    })
    .filter((line): line is string => line != null)
    .join(' ');

  const title = needsYou > 0
    ? t(
        'opportunities.queue.needsYou',
        needsYou === 1 ? '{{count}} thing needs you today.' : '{{count}} things need you today.',
        { count: needsYou },
      )
    : t('opportunities.queue.nothingDue', 'Nothing is due today.');

  return (
    <div className="mb-7">
      <WelcomeBanner
        id="opportunities-queue-greeting"
        firstName={firstName}
        title={title}
        description={stakes || undefined}
      />
    </div>
  );
}
