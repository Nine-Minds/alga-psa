import dynamic from 'next/dynamic';
import React from 'react';

// Dynamically import the NavigationSlot from EE or use empty fallback
const NavigationSlot = dynamic(
  () => import('@ee/lib/extensions/ui/navigation/NavigationSlot').then(mod => mod.NavigationSlot),
  { 
    ssr: false,
    loading: () => null
  }
);

interface DynamicNavigationSlotProps {
  collapsed?: boolean;
}

export const DynamicNavigationSlot: React.FC<DynamicNavigationSlotProps> = ({ collapsed = false }) => {
  // Only render in enterprise edition
  if (process.env.NEXT_PUBLIC_EDITION !== 'enterprise') {
    return null;
  }

  return <NavigationSlot collapsed={collapsed} />;
};