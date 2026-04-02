'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// OSS stub implementation for Settings Extensions feature
function EnterpriseFeatureStub({ featureKey, defaultFeature }: { featureKey: string; defaultFeature: string }) {
  const { t } = useTranslation('msp/extensions');

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">
          {t('enterpriseFeature.title', { defaultValue: 'Enterprise Feature' })}
        </h2>
        <p className="text-gray-600">
          {t('enterpriseFeature.description', {
            defaultValue: '{{feature}} require Enterprise Edition. Please upgrade to access this feature.',
            feature: t(featureKey, { defaultValue: defaultFeature })
          })}
        </p>
      </div>
    </div>
  );
}

export const ExtensionSettings = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.settings" defaultFeature="Extension settings" />
);
export const ExtensionDetailsModal = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.details" defaultFeature="Extension details" />
);
export const ExtensionPermissions = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.permissions" defaultFeature="Extension permissions" />
);
export const Extensions = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.management" defaultFeature="Extensions management" />
);
export const InstallerPanel = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.installer" defaultFeature="Extension installer" />
);
export const ExtensionDetails = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.details" defaultFeature="Extension details" />
);

// For compatibility with InstallExtensionSimple imports - alias to stub
export const InstallExtensionSimple = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.installer" defaultFeature="Extension installer" />
);

// Dynamic component stubs
export const DynamicExtensionsComponent = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.management" defaultFeature="Extensions management" />
);
export const DynamicInstallExtensionComponent = () => (
  <EnterpriseFeatureStub featureKey="settings.featureNames.installer" defaultFeature="Extension installer" />
);
