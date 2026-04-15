'use client';

// Stub implementation for CE build
import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export const ExtensionComponentLoader: React.FC<any> = () => {
  return null;
};

function CommunityEditionFallback({ translationKey, defaultValue }: { translationKey: string; defaultValue: string }) {
  const { t } = useTranslation('msp/extensions');

  return <div className="text-center py-8 text-gray-500">{t(translationKey, { defaultValue })}</div>;
}

// Export stub for DynamicExtensionsComponent to match EE interface
export const DynamicExtensionsComponent: React.FC<any> = () => {
  return (
    <CommunityEditionFallback
      translationKey="communityEdition.dynamicListUnavailable"
      defaultValue="Extensions not available in Community Edition"
    />
  );
};

// Export stub for DynamicInstallExtensionComponent to match EE interface
export const DynamicInstallExtensionComponent: React.FC<any> = () => {
  return (
    <CommunityEditionFallback
      translationKey="communityEdition.dynamicInstallUnavailable"
      defaultValue="Extension installation not available in Community Edition"
    />
  );
};

// Export stub for isExtensionsAvailable to match EE interface
export const isExtensionsAvailable = (): boolean => {
  return false;
};

export default ExtensionComponentLoader;
