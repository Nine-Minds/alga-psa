/**
 * Empty ExtensionSettings Component for Community Edition
 *
 * This component is used when the EE ExtensionSettings is not available
 */
'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function ExtensionSettings() {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="text-center py-8">
      <h3 className="text-lg font-medium text-gray-900 mb-2">{t('settings.unavailable.title')}</h3>
      <p className="text-gray-600">
        {t('settings.unavailable.description')}
      </p>
    </div>
  );
}
