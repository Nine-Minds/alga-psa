'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function ManagedDomainList(): React.JSX.Element {
  const { t } = useTranslation('msp/email-providers');

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">{t('managed.proFeature.title')}</h2>
      <p className="text-gray-600">{t('managed.proFeature.domainsDescription')}</p>
    </div>
  );
}
