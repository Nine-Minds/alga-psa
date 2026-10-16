'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface EntraIntegrationPageProps {
  canUseCipp?: boolean;
}

const EntraIntegrationPage: React.FC<EntraIntegrationPageProps> = () => {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-lg font-medium">{t('integrations.proFeature.title', { defaultValue: 'Pro Feature' })}</p>
      <p className="mt-2 text-sm">
        {t('integrations.entra.proFeature.description', { defaultValue: 'Microsoft Entra integration is available in AlgaPSA Pro.' })}
      </p>
    </div>
  );
};

export default EntraIntegrationPage;
