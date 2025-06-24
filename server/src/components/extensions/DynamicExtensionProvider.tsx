import React from 'react';

interface DynamicExtensionProviderProps {
  children: React.ReactNode;
}

/**
 * CE placeholder for extension provider - just passes through children
 * EE version will be loaded by module aliasing in next.config.mjs
 */
export const DynamicExtensionProvider: React.FC<DynamicExtensionProviderProps> = ({ children }) => {
  return <>{children}</>;
};