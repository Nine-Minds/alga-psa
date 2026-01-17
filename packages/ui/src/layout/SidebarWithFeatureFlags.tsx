'use client';

import React from 'react';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import Sidebar from './Sidebar';
import { useEffect } from 'react';
import {
  navigationSections as originalSections,
  bottomMenuItems,
  MenuItem,
  NavigationSection,
  menuItems as legacyMenuItems,
  NavMode
} from 'server/src/config/menuConfig';
import { analytics } from 'server/src/lib/analytics/client';

interface SidebarWithFeatureFlagsProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  disableTransition?: boolean;
  mode?: NavMode;
  onBackToMain?: () => void;
}

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
  const advancedFeatureFlag = useFeatureFlag('advanced-features-enabled');
  const isAdvancedFeaturesEnabled = typeof advancedFeatureFlag === 'boolean' ? advancedFeatureFlag : advancedFeatureFlag?.enabled;
  const navigationFlag = useFeatureFlag('ui-navigation-v2', { defaultValue: true });
  const useNavigationSections = typeof navigationFlag === 'boolean' ? navigationFlag : navigationFlag?.enabled ?? false;

  useEffect(() => {
    if (useNavigationSections) {
      analytics.capture('ui.nav.v2.enabled');
    }
  }, [useNavigationSections]);

  // Filter and modify menu items based on feature flags
  const menuSections = React.useMemo<NavigationSection[]>(() => {
    if (!useNavigationSections) {
      return [
        {
          title: '',
          items: legacyMenuItems
        }
      ];
    }

    return originalSections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.name === 'Automation Hub' && !isAdvancedFeaturesEnabled) {
          return {
            ...item,
            href: '/msp/automation-hub',
            subItems: undefined,
            underConstruction: true
          } as MenuItem;
        }
        return item;
      })
    }));
  }, [isAdvancedFeaturesEnabled, useNavigationSections]);

  return (
    <Sidebar
      {...props}
      menuSections={menuSections}
      bottomMenuItems={bottomMenuItems}
      disableTransition={props.disableTransition}
      mode={props.mode}
      onBackToMain={props.onBackToMain}
    />
  );
}
