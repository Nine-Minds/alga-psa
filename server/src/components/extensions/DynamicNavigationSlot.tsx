import React from 'react';
import dynamic from 'next/dynamic';

interface DynamicNavigationSlotProps {
  collapsed?: boolean;
}

// Dynamically import the NavigationSlot from EE
const NavigationSlot = dynamic(
  () => import('@ee/lib/extensions/ui/navigation/NavigationSlot').then(mod => mod.NavigationSlot),
  { 
    ssr: false,
    loading: () => null
  }
);

export const DynamicNavigationSlot: React.FC<DynamicNavigationSlotProps> = ({ collapsed = false }) => {
  // Only render in enterprise edition
  if (process.env.NEXT_PUBLIC_EDITION !== 'enterprise') {
    return null;
  }

  return <NavigationSlot collapsed={collapsed} />;
};