'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const DattoRmmIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="py-8 text-center text-muted-foreground">
      <p className="text-lg font-medium">{t('integrations.proFeature.title')}</p>
      <p className="mt-2 text-sm">
        {t('integrations.rmm.datto.proFeature.description')}
      </p>
    </div>
  );
};

export default DattoRmmIntegrationSettings;
