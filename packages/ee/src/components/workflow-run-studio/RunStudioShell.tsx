'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import React from 'react';

export default function RunStudioShell({ runId }: { runId: string }) {
  const { t } = useTranslation('msp/workflows');

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{t('runStudio.communityEdition.title')}</h2>
        <p className="text-gray-600">
          {t('runStudio.communityEdition.description')}
        </p>
        <p className="text-sm text-gray-500 mt-3">{t('runStudio.communityEdition.runId', { runId: runId || '—' })}</p>
      </div>
    </div>
  );
}
