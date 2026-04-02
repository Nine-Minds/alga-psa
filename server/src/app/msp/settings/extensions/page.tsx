'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function ExtensionsLoadingFallback() {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="flex items-center justify-center h-64 text-gray-500">
      {t('settings.loading.extensions', { defaultValue: 'Loading extensions...' })}
    </div>
  );
}

const DynamicExtensions = dynamic(
  () => import('@product/settings-extensions/entry').then((mod) => mod.Extensions),
  {
    ssr: false,
    loading: ExtensionsLoadingFallback,
  }
);

export default function ExtensionsPage() {
  return <DynamicExtensions />;
}
