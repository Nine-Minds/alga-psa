'use client';

/**
 * Hudu Integration Settings - Community Edition Stub
 *
 * Placeholder for Community Edition builds. The Hudu IT-documentation
 * integration is only available in Enterprise Edition.
 */

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const HuduIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">{t('integrations.proFeature.title')}</p>
      <p className="mt-2 text-sm">
        {t('integrations.hudu.proFeature.description')}
      </p>
    </div>
  );
};

export default HuduIntegrationSettings;
