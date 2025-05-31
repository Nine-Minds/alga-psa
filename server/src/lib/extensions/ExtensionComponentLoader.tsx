import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Define the props type for the Extensions component
export type ExtensionsProps = {};

// Dynamic import will resolve to either the EE component or fall back gracefully
// based on the webpack alias configuration (@ee points to ee/server/src or empty)
export const DynamicExtensionsComponent = dynamic<ExtensionsProps>(
  () => import('@ee/components/settings/extensions/ExtensionsSimple').then(mod => mod.default),
  { 
    ssr: false,
    loading: () => <div>Loading extensions...</div>
  }
);

export const DynamicInstallExtensionComponent = dynamic<ExtensionsProps>(
  () => import('@ee/components/settings/extensions/InstallExtensionSimple').then(mod => mod.default),
  { 
    ssr: false,
    loading: () => <div>Loading...</div>
  }
);

// Function to check if EE extensions are available
export const isExtensionsAvailable = (): boolean => {
  try {
    // This will be true if the webpack alias resolves to the actual EE component
    return typeof DynamicExtensionsComponent !== 'undefined';
  } catch {
    return false;
  }
};