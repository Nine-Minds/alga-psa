'use client';

import React from 'react';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import Sidebar from './Sidebar';
import { menuItems as originalMenuItems, bottomMenuItems, MenuItem } from '../../config/menuConfig';
import { Construction } from 'lucide-react';

interface SidebarWithFeatureFlagsProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
  const featureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;

  // Filter and modify menu items based on feature flags
  const menuItems = React.useMemo(() => {
    return originalMenuItems.map(item => {
      // For Billing menu item, check feature flag
      if (item.name === 'Billing' && !isBillingEnabled) {
        // Return a modified billing menu item that shows construction status
        return {
          ...item,
          // Replace all sub-items with a single "Under Construction" item
          href: '/msp/billing',
          subItems: undefined,
          // Add a visual indicator that this is under construction
          underConstruction: true
        } as MenuItem & { underConstruction?: boolean };
      }
      return item;
    });
  }, [isBillingEnabled]);

  return <Sidebar {...props} menuItems={menuItems} bottomMenuItems={bottomMenuItems} />;
}