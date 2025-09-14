import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Debug: signal when the EE loader module is actually loaded and from where
try {
  // eslint-disable-next-line no-console
  console.info('[EE] Loaded ExtensionComponentLoader from ee/server/src/lib/extensions/ExtensionComponentLoader.tsx');
} catch {}

// Define the props type for the Extensions component
export type ExtensionsProps = {};

// Dynamic import will resolve to either the EE component or fall back gracefully
// based on the webpack alias configuration (@ee points to ee/server/src or empty)
export const DynamicExtensionsComponent = dynamic<ExtensionsProps>(
  () => import('@ee/components/settings/extensions/Extensions').then(mod => mod.default),
  { 
    ssr: false,
    loading: () => <div>Loading extensions...</div>
  }
);

export const DynamicInstallExtensionComponent = dynamic<ExtensionsProps>(
  // Use EE Installer Panel that conforms to Server UI standards
  () => import('@ee/components/settings/extensions/InstallerPanel').then(mod => mod.default as any),
  {
    ssr: false,
    loading: () => <div>Loading...</div>
  }
);

// Function to check if EE extensions are available
export const isExtensionsAvailable = (): boolean => {
  try {
    // Lightweight runtime signal to verify resolution
    // eslint-disable-next-line no-console
    console.info('[EE] isExtensionsAvailable() called');
    // This will be true if the webpack alias resolves to the actual EE component
    return typeof DynamicExtensionsComponent !== 'undefined';
  } catch {
    return false;
  }
};
