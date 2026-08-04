'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { IQueueFoundTotal } from '@alga-psa/types';

/**
 * The queue header: addresses the user by name and carries the stakes —
 * the found-money total from the generators, stated plainly.
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
  const hour = new Date().getHours();
  const greeting = hour < 12
    ? t('opportunities.queue.greetingMorning', 'Good morning, {{name}}.', { name: firstName })
    : hour < 18
      ? t('opportunities.queue.greetingAfternoon', 'Good afternoon, {{name}}.', { name: firstName })
      : t('opportunities.queue.greetingEvening', 'Good evening, {{name}}.', { name: firstName });

  const stakes = foundTotals
    .map((total) => {
      if (total.mrr_cents > 0) {
        return t(
          'opportunities.queue.stakesMrr',
          '{{amount}}/mo is sitting in your own data, nothing typed in.',
          { amount: formatCurrencyFromMinorUnits(total.mrr_cents, undefined, total.currency_code) }
        );
      }
      if (total.nrr_cents > 0) {
        return t(
          'opportunities.queue.stakesNrr',
          '{{amount}} of project work is sitting in your own data.',
          { amount: formatCurrencyFromMinorUnits(total.nrr_cents, undefined, total.currency_code) }
        );
      }
      return null;
    })
    .filter((line): line is string => line != null)
    .join(' ');

  return (
    <header id="opportunities-queue-greeting" className="mb-7">
      <h2 className="font-semibold text-2xl text-[rgb(var(--color-text-900))]">
        {greeting}
      </h2>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
        {needsYou > 0
          ? t(
              'opportunities.queue.needsYou',
              needsYou === 1 ? '{{count}} thing needs you today.' : '{{count}} things need you today.',
              { count: needsYou },
            )
          : t('opportunities.queue.nothingDue', 'Nothing is due today.')}
        {stakes ? ` ${stakes}` : ''}
      </p>
    </header>
  );
}
