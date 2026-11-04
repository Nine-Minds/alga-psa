'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const DnDFlow: React.FC = () => {
  const { t } = useTranslation('msp/workflows');

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center p-8 max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          {t('flow.proFeature.title')}
        </h2>
        <p className="text-gray-600">
          {t('flow.proFeature.description')}
        </p>
      </div>
    </div>
  );
};

// Named export for @alga-psa/workflows/entry compatibility
export { DnDFlow };
export default DnDFlow;
