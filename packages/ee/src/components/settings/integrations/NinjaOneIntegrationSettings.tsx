'use client';

/**
 * NinjaOne Integration Settings - Community Edition Stub
 *
 * This is a placeholder component for Community Edition builds.
 * The actual NinjaOne integration is only available in Enterprise Edition.
 */

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const NinjaOneIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">{t('integrations.proFeature.title')}</p>
      <p className="mt-2 text-sm">
        {t('integrations.rmm.ninjaOne.proFeature.description')}
      </p>
    </div>
  );
};

export default NinjaOneIntegrationSettings;
