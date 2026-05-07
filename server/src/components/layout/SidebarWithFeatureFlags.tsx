'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import Sidebar from './Sidebar';
import {
  bottomMenuItems,
  menuItems as legacyMenuItems,
  navigationSections as originalSections,
  settingsNavigationSections,
  type MenuItem,
  type NavigationSection,
} from '@/config/menuConfig';
import { getCurrentUserPermissions } from '@alga-psa/user-composition/actions';
import { useTier } from '@/context/TierContext';
import { useProduct } from '@/context/ProductContext';
import { filterMenuSectionsByProduct } from '@/lib/productSurfaceRegistry';

export function filterMenuItemsByFeatureAccess(
  items: readonly MenuItem[],
  hasFeature: (feature: NonNullable<MenuItem['requiredFeature']>) => boolean
): MenuItem[] {
  return items.reduce<MenuItem[]>((visibleItems, item) => {
    if (item.requiredFeature && !hasFeature(item.requiredFeature)) {
      return visibleItems;
    }

    const filteredSubItems = item.subItems
      ? filterMenuItemsByFeatureAccess(item.subItems, hasFeature)
      : undefined;

    visibleItems.push({
      ...item,
      subItems: filteredSubItems,
    });

    return visibleItems;
  }, []);
}

export function filterNavigationSectionsByFeatureAccess(
  sections: readonly NavigationSection[],
  hasFeature: (feature: NonNullable<MenuItem['requiredFeature']>) => boolean
): NavigationSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: filterMenuItemsByFeatureAccess(section.items, hasFeature),
    }))
    .filter((section) => section.items.length > 0);
}

type SidebarWithFeatureFlagsProps = React.ComponentProps<typeof Sidebar>;

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
  const navigationFlag = useFeatureFlag('ui-navigation-v2', { defaultValue: true });
  const useNavigationSections =
    typeof navigationFlag === 'boolean' ? navigationFlag : navigationFlag?.enabled ?? false;
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const { hasFeature } = useTier();
  const { productCode } = useProduct();
  const isAlgadesk = productCode === 'algadesk';

  useEffect(() => {
    if (!useNavigationSections) return;
    const analytics = (globalThis as any)?.analytics;
    if (analytics?.capture) {
      analytics.capture('ui.nav.v2.enabled');
    }
  }, [useNavigationSections]);

  useEffect(() => {
    let isMounted = true;
    const loadPermissions = async () => {
      try {
        const permissions = await getCurrentUserPermissions();
        if (isMounted) {
          setUserPermissions(permissions);
        }
      } catch (error) {
        console.error('[Sidebar] Failed to load user permissions:', error);
        if (isMounted) {
          setUserPermissions([]);
        }
      }
    };

    loadPermissions();
    return () => {
      isMounted = false;
    };
  }, []);

  const canWorkflowAdmin = userPermissions.includes('workflow:admin');

  // Filter and modify menu items based on permissions
  const menuSections = useMemo<NavigationSection[]>(() => {
    const baseSections = useNavigationSections
      ? originalSections
      : [{ title: '', items: legacyMenuItems } satisfies NavigationSection];

    const filteredSections = baseSections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.name === 'Workflows') {
          const filteredSubItems = item.subItems?.filter((subItem) => {
            if (subItem.name !== 'Dead Letter') return true;
            return canWorkflowAdmin;
          });
          return { ...item, subItems: filteredSubItems };
        }

        return item;
      }).filter((item): item is MenuItem => item !== null)
    }));

    return filterMenuSectionsByProduct(
      productCode,
      filterNavigationSectionsByFeatureAccess(filteredSections, hasFeature),
    );
  }, [canWorkflowAdmin, useNavigationSections, hasFeature, productCode]);

  const settingsSections = useMemo<NavigationSection[]>(() => {
    return filterMenuSectionsByProduct(productCode, settingsNavigationSections);
  }, [productCode]);

  return (
    <Sidebar
      {...props}
      menuSections={menuSections}
      bottomMenuItems={bottomMenuItems}
      appDisplayName={isAlgadesk ? 'Algadesk' : 'AlgaPSA'}
      appLogoAlt={isAlgadesk ? 'Algadesk Logo' : 'AlgaPSA Logo'}
      settingsSectionsOverride={settingsSections}
    />
  );
}
