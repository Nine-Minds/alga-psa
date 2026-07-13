'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';

/**
 * The queue header: addresses the user by name and carries the stakes —
 * the found-money total from the generators, stated plainly.
 */
export function QueueGreeting({
  firstName,
  actionCount,
  quietCount,
  foundMrrCents,
  foundNrrCents,
  currencyCode,
}: {
  firstName: string;
  actionCount: number;
  quietCount: number;
  foundMrrCents: number;
  foundNrrCents: number;
  currencyCode: string;
}) {
  const { t } = useTranslation();
  const needsYou = actionCount + quietCount;
  const foundMrr = formatCurrencyFromMinorUnits(foundMrrCents, undefined, currencyCode);
  const foundNrr = formatCurrencyFromMinorUnits(foundNrrCents, undefined, currencyCode);

  let stakes: string | null = null;
  if (foundMrrCents > 0) {
    stakes = t(
      'opportunities.queue.stakesMrr',
      '{{amount}}/mo is sitting in your own data, nothing typed in.',
      { amount: foundMrr }
    );
  } else if (foundNrrCents > 0) {
    stakes = t(
      'opportunities.queue.stakesNrr',
      '{{amount}} of project work is sitting in your own data.',
      { amount: foundNrr }
    );
  }

  return (
    <header id="opportunities-queue-greeting" className="mb-7">
      <h2 className="font-semibold text-2xl text-[rgb(var(--color-text-900))]">
        {t('opportunities.queue.greeting', 'Morning, {{name}}.', { name: firstName })}
      </h2>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
        {needsYou > 0
          ? t('opportunities.queue.needsYou', '{{count}} things need you today.', { count: needsYou })
          : t('opportunities.queue.nothingDue', 'Nothing is due today.')}
        {stakes ? ` ${stakes}` : ''}
      </p>
    </header>
  );
}
