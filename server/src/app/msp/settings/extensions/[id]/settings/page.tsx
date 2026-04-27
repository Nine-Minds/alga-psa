'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function ExtensionSettingsLoading() {
  const { t } = useTranslation('common');
  return <div className="flex items-center justify-center h-64 text-gray-500">{t('pages.loading.extensionSettings')}</div>;
}

// Dynamic import to avoid bundling EE code in OSS builds
const ExtensionSettings = dynamic(
  () => import('@enterprise/components/settings/extensions/ExtensionSettings'),
  {
    loading: () => <ExtensionSettingsLoading />,
    ssr: false
  }
);

const FeaturePlaceholder = dynamic(
  () => import('@alga-psa/ui/components/feature-flags/FeaturePlaceholder').then(mod => mod.FeaturePlaceholder),
  { ssr: false }
);

export default function ExtensionSettingsPage() {
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  if (!isEEAvailable) {
    return <FeaturePlaceholder />;
  }

  return <ExtensionSettings />;
}
