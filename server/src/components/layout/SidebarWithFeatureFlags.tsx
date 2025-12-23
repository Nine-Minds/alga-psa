'use client';

import React, { useEffect } from 'react';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import Sidebar from './Sidebar';
import {
  navigationSections as originalSections,
  bottomMenuItems,
  NavigationSection,
  menuItems as legacyMenuItems,
  NavMode
} from '../../config/menuConfig';
import { analytics } from 'server/src/lib/analytics/client';

interface SidebarWithFeatureFlagsProps {
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  disableTransition?: boolean;
  mode?: NavMode;
  onBackToMain?: () => void;
}

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
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

    // Automation Hub is now fully available with the new workflow designer
    return originalSections;
  }, [useNavigationSections]);

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
