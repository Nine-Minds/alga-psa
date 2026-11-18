import React from 'react';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata() {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');
  return { title: t('unavailable.metadataTitle') };
}

// Relax props typing to satisfy Next page constraints in build
export default async function Page({ params }: any) {
  const { t } = await getServerTranslation(undefined, 'msp/extensions');
  const { id } = await params;
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">{t('unavailable.title')}</h1>
      <p className="mt-2 text-sm text-gray-600">
        {t('unavailable.description')}
      </p>
      <p className="mt-4 text-xs text-gray-500">{t('unavailable.requestedId', { id })}</p>
    </div>
  );
}
