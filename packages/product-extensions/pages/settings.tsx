import React from 'react';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

// Stub page for extension settings - implement in EE
export default async function ExtensionSettingsPage() {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-900">
        {t('settingsPage.title', { defaultValue: 'Extension Settings' })}
      </h1>
      <p className="text-gray-600 mt-2">
        {t('settingsPage.description', {
          defaultValue: 'Extension settings are available in Enterprise Edition.'
        })}
      </p>
    </div>
  );
}

export const metadata = {
  title: 'Extension Settings',
  description: 'Configure extension settings',
};
