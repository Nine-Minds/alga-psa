import React from 'react';

interface DynamicNavigationSlotProps {
  collapsed?: boolean;
}

/**
 * CE placeholder for navigation slot - renders nothing
 * EE version will be loaded by module aliasing in next.config.mjs
 */
export const DynamicNavigationSlot: React.FC<DynamicNavigationSlotProps> = () => {
  return null;
};