import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export const parsePolicy = (_policyString: string) => {
  throw new Error('Policy parsing is an Enterprise Edition feature');
};

export const PolicyManagement: React.FC = () => {
  const { t } = useTranslation('msp/settings');

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">{t('policyManagement.proFeature.title')}</h2>
        <p className="text-gray-600">
          {t('policyManagement.proFeature.description')}
        </p>
      </div>
    </div>
  );
};

export default {
  parsePolicy,
  PolicyManagement,
};
