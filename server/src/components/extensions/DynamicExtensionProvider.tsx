import React from 'react';
import dynamic from 'next/dynamic';

interface DynamicExtensionProviderProps {
  children: React.ReactNode;
}

// Dynamically import the ExtensionProvider from EE
const ExtensionProvider = dynamic(
  () => import('@ee/lib/extensions/ui/ExtensionProvider').then(mod => mod.ExtensionProvider),
  { 
    ssr: false,
    loading: () => <>{null}</>
  }
);

export const DynamicExtensionProvider: React.FC<DynamicExtensionProviderProps> = ({ children }) => {
  // Only wrap with ExtensionProvider in enterprise edition
  if (process.env.NEXT_PUBLIC_EDITION === 'enterprise') {
    return <ExtensionProvider>{children}</ExtensionProvider>;
  }

  // In community edition, just render children directly
  return <>{children}</>;
};