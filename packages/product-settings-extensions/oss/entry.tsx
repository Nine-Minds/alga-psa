import React from 'react';

// OSS stub implementation for Settings Extensions feature
const EnterpriseFeatureStub = ({ feature }: { feature: string }) => (
  <div className="flex items-center justify-center h-64">
    <div className="text-center">
      <h2 className="text-xl font-semibold mb-2">Enterprise Feature</h2>
      <p className="text-gray-600">
        {feature} require Enterprise Edition. Please upgrade to access this feature.
      </p>
    </div>
  </div>
);

export const ExtensionSettings = () => <EnterpriseFeatureStub feature="Extension settings" />;
export const ExtensionDetailsModal = () => <EnterpriseFeatureStub feature="Extension details" />;
export const ExtensionPermissions = () => <EnterpriseFeatureStub feature="Extension permissions" />;
export const Extensions = () => <EnterpriseFeatureStub feature="Extensions management" />;
export const InstallerPanel = () => <EnterpriseFeatureStub feature="Extension installer" />;
export const ExtensionDetails = () => <EnterpriseFeatureStub feature="Extension details" />;

// For compatibility with InstallExtensionSimple imports - alias to stub
export const InstallExtensionSimple = () => <EnterpriseFeatureStub feature="Extension installer" />;

// Dynamic component stubs
export const DynamicExtensionsComponent = () => <EnterpriseFeatureStub feature="Extensions management" />;
export const DynamicInstallExtensionComponent = () => <EnterpriseFeatureStub feature="Extension installer" />;
