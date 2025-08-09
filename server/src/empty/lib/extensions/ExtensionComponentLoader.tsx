// Stub implementation for CE build
import React from 'react';

export const ExtensionComponentLoader: React.FC<any> = () => {
  return null;
};

// Export stub for DynamicExtensionsComponent to match EE interface
export const DynamicExtensionsComponent: React.FC<any> = () => {
  return <div className="text-center py-8 text-gray-500">Extensions not available in Community Edition</div>;
};

// Export stub for DynamicInstallExtensionComponent to match EE interface
export const DynamicInstallExtensionComponent: React.FC<any> = () => {
  return <div className="text-center py-8 text-gray-500">Extension installation not available in Community Edition</div>;
};

// Export stub for isExtensionsAvailable to match EE interface
export const isExtensionsAvailable = (): boolean => {
  return false;
};

export default ExtensionComponentLoader;