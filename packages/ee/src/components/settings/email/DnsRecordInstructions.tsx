'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function DnsRecordInstructions(): React.JSX.Element {
  const { t } = useTranslation('msp/email-providers');

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">{t('managed.dnsRecordInstructions.proFeature.title')}</h2>
      <p className="text-gray-600">{t('managed.dnsRecordInstructions.proFeature.description')}</p>
    </div>
  );
}
