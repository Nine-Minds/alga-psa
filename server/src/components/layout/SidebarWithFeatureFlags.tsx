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
  const billingFeatureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof billingFeatureFlag === 'boolean' ? billingFeatureFlag : billingFeatureFlag?.enabled;
  
  const advancedFeatureFlag = useFeatureFlag('advanced-features-enabled');
  const isAdvancedFeaturesEnabled = typeof advancedFeatureFlag === 'boolean' ? advancedFeatureFlag : advancedFeatureFlag?.enabled;

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
      
      // For Automation Hub menu item, check advanced features flag
      if (item.name === 'Automation Hub' && !isAdvancedFeaturesEnabled) {
        return {
          ...item,
          href: '/msp/automation-hub',
          subItems: undefined,
          underConstruction: true
        } as MenuItem & { underConstruction?: boolean };
      }
      
      // For System menu item, check advanced features flag
      if (item.name === 'System' && !isAdvancedFeaturesEnabled) {
        return {
          ...item,
          href: '/msp/jobs',
          subItems: undefined,
          underConstruction: true
        } as MenuItem & { underConstruction?: boolean };
      }
      
      return item;
    });
  }, [isBillingEnabled, isAdvancedFeaturesEnabled]);

  return <Sidebar {...props} menuItems={menuItems} bottomMenuItems={bottomMenuItems} />;
}