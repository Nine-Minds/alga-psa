'use client';

import dynamic from 'next/dynamic';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function InstallExtensionLoadingFallback() {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="flex justify-center items-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <span className="ml-3 text-gray-600">
        {t('settings.loading.installer', { defaultValue: 'Loading installer...' })}
      </span>
    </div>
  );
}

// Dynamically load the extension install component using the stable package path
const DynamicInstallExtensionComponent = dynamic(
  () => import('@product/settings-extensions/entry').then(mod => mod.InstallExtensionSimple),
  {
    ssr: false,
    loading: InstallExtensionLoadingFallback,
  }
);

export default function InstallExtensionPage() {
  return <DynamicInstallExtensionComponent />;
}
