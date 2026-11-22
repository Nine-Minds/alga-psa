'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const STEPS = ['buy', 'enable', 'signIn'] as const;

/**
 * What co-managed IT is and who needs a seat, for an administrator buying for the first time. Pure
 * content with no state: a surface composes it beside the quantity control (the sponsor overview does;
 * Account Management does not).
 */
export default function CoManagedSeatExplainer() {
  const { t } = useTranslation('msp/licensing');
  return (
    <div id="co-managed-seat-explainer" className="space-y-4">
      <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{t('coManaged.howItWorks.title')}</h3>
      <ol className="space-y-4">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span aria-hidden="true" className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[rgb(var(--color-primary-100))] text-sm font-semibold text-[rgb(var(--color-primary-700))]">{index + 1}</span>
            <div>
              <p className="font-semibold text-[rgb(var(--color-text-900))]">{t(`coManaged.howItWorks.${step}.title`)}</p>
              <p className="text-sm text-[rgb(var(--color-text-600))]">{t(`coManaged.howItWorks.${step}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-[rgb(var(--color-border-100))] pt-4 text-sm text-[rgb(var(--color-text-600))]">
        <strong className="font-semibold text-[rgb(var(--color-text-900))]">{t('coManaged.whoNeedsSeat.label')}</strong>{' '}
        {t('coManaged.whoNeedsSeat.answer')}
      </p>
    </div>
  );
}
