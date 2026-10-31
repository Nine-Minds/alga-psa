/**
 * Empty Extensions Component for Community Edition
 * 
 * This component is used when the EE Extensions system is not available
 */
'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function Extensions() {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="text-center py-8">
      <h3 className="text-lg font-medium text-gray-900 mb-2">{t('list.unavailable.title')}</h3>
      <p className="text-gray-600">
        {t('list.unavailable.description')}
      </p>
    </div>
  );
}
