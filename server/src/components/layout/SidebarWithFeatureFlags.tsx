'use client';

import React, { useEffect, useMemo } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import Sidebar from './Sidebar';
import {
  bottomMenuItems,
  menuItems as legacyMenuItems,
  navigationSections as originalSections,
  type MenuItem,
  type NavigationSection
} from '@/config/menuConfig';

type SidebarWithFeatureFlagsProps = React.ComponentProps<typeof Sidebar>;

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
  const advancedFeatureFlag = useFeatureFlag('advanced-features-enabled');
  const isAdvancedFeaturesEnabled =
    typeof advancedFeatureFlag === 'boolean' ? advancedFeatureFlag : advancedFeatureFlag?.enabled;
  const navigationFlag = useFeatureFlag('ui-navigation-v2', { defaultValue: true });
  const useNavigationSections =
    typeof navigationFlag === 'boolean' ? navigationFlag : navigationFlag?.enabled ?? false;

  useEffect(() => {
    if (!useNavigationSections) return;
    const analytics = (globalThis as any)?.analytics;
    if (analytics?.capture) {
      analytics.capture('ui.nav.v2.enabled');
    }
  }, [useNavigationSections]);

  // Filter and modify menu items based on feature flags
  const menuSections = useMemo<NavigationSection[]>(() => {
    const baseSections = useNavigationSections
      ? originalSections
      : [{ title: '', items: legacyMenuItems } satisfies NavigationSection];

    if (!useNavigationSections) {
      return baseSections;
    }

    return baseSections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.name === 'Automation Hub' && !isAdvancedFeaturesEnabled) {
          const updated: MenuItem = {
            ...item,
            subItems: undefined,
            underConstruction: true
          };
          return updated;
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
    />
  );
}
