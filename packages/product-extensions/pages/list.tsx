import React from 'react';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// Stub page for extensions list - implement in EE
export default async function ExtensionsListPage() {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-900">
        {t('page.title', { defaultValue: 'Extensions' })}
      </h1>
      <p className="text-gray-600 mt-2">
        {t('page.description', {
          defaultValue: 'Extensions management is available in Enterprise Edition.'
        })}
      </p>
    </div>
  );
}

export const metadata = {
  title: 'Extensions',
  description: 'Manage extensions',
};
