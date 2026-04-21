'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export const DnDFlow = () => {
  const { t } = useTranslation('msp/licensing');
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">
          {t('workflowDesigner.enterpriseHeading', { defaultValue: 'Enterprise Feature' })}
        </h2>
        <p className="text-gray-600">
          {t('workflowDesigner.unavailable', {
            defaultValue: 'Workflow designer requires Enterprise Edition. Please upgrade to access this feature.'
          })}
        </p>
      </div>
    </div>
  );
};

export default DnDFlow;
