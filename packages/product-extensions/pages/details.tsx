import React from 'react';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// Stub page for extension details - implement in EE
export default async function ExtensionDetailsPage() {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-900">
        {t('detailsPage.title', { defaultValue: 'Extension Details' })}
      </h1>
      <p className="text-gray-600 mt-2">
        {t('detailsPage.description', {
          defaultValue: 'Extension details are available in Enterprise Edition.'
        })}
      </p>
    </div>
  );
}

export const metadata = {
  title: 'Extension Details',
  description: 'View extension details',
};
