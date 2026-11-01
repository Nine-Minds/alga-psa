'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function TeamsTabPage(): React.ReactElement {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="space-y-2 rounded-xl border border-gray-200 bg-[rgb(var(--color-card))] p-6 card-elevated">
        <h1 className="text-lg font-semibold text-gray-900">{t('integrations.teams.unavailable.tabTitle')}</h1>
        <p className="text-sm text-gray-600">{t('integrations.teams.unavailable.description')}</p>
      </div>
    </div>
  );
}
