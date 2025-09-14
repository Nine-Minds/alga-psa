import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

// Define the props type for the Extensions component
export type ExtensionsProps = {};

// Dynamic imports resolve via the stable feature package. Aliases flip EE/OSS.
export const DynamicExtensionsComponent = dynamic<ExtensionsProps>(
  () =>
    import('@product/settings-extensions/entry').then(
      (mod: any) => mod.DynamicExtensionsComponent
    ),
  {
    ssr: false,
    loading: () => <div>Loading extensions...</div>,
  }
);

export const DynamicInstallExtensionComponent = dynamic<ExtensionsProps>(
  () =>
    import('@product/settings-extensions/entry').then(
      (mod: any) => mod.DynamicInstallExtensionComponent
    ),
  {
    ssr: false,
    loading: () => <div>Loading...</div>,
  }
);

// Function to check if EE extensions are available
export const isExtensionsAvailable = (): boolean => true;
