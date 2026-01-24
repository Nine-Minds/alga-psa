import React from 'react';

interface DynamicExtensionProviderProps {
  children: React.ReactNode;
}

/**
 * CE placeholder for extension provider - just passes through children.
 * EE version can be provided via edition swapping/aliasing.
 */
export const DynamicExtensionProvider: React.FC<DynamicExtensionProviderProps> = ({ children }) => {
  return <>{children}</>;
};

