'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Community Edition stub. Enterprise builds alias @enterprise to
 * ee/server/src, replacing this with the real settings component.
 */
export default function HuntressIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="rounded-lg border p-6 text-center">
      <h3 className="text-base font-semibold">{t('integrations.rmm.huntress.proFeature.title')}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('integrations.rmm.huntress.proFeature.description')}
      </p>
    </div>
  );
}
