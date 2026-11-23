'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedPurchasePool from './CoManagedPurchasePool';

/**
 * The overview for an actor whose only claim is commercial eligibility: the pool and nothing else. No
 * archive link, client search, setup links or SLA administration, and no client query is read.
 */
export default function CoManagedPurchaseOverview() {
  const { t } = useTranslation('msp/licensing');
  return (
    <div id="co-managed-purchase-overview" className="min-w-0 space-y-4">
      <header>
        <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.title')}</h1>
        <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
          {t('coManaged.description')}
        </p>
      </header>
      <CoManagedPurchasePool />
    </div>
  );
}
