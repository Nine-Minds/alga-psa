'use client';

import React from 'react';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import Sidebar from './Sidebar';
import { menuItems as originalMenuItems, bottomMenuItems, MenuItem } from '../../config/menuConfig';

interface SidebarWithFeatureFlagsProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  disableTransition?: boolean;
}

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
  const advancedFeatureFlag = useFeatureFlag('advanced-features-enabled');
  const isAdvancedFeaturesEnabled = typeof advancedFeatureFlag === 'boolean' ? advancedFeatureFlag : advancedFeatureFlag?.enabled;

  // Filter and modify menu items based on feature flags
  const menuItems = React.useMemo(() => {
    return originalMenuItems.map(item => {
      // For Automation Hub menu item, check advanced features flag
      if (item.name === 'Automation Hub' && !isAdvancedFeaturesEnabled) {
        return {
          ...item,
          href: '/msp/automation-hub',
          subItems: undefined,
          underConstruction: true
        } as MenuItem & { underConstruction?: boolean };
      }

      return item;
    });
  }, [isAdvancedFeaturesEnabled]);

  return (
    <Sidebar
      {...props}
      menuItems={menuItems}
      bottomMenuItems={bottomMenuItems}
      disableTransition={props.disableTransition}
    />
  );
}
