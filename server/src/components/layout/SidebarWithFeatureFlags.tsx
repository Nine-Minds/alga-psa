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
import { getCurrentUserPermissions } from '@alga-psa/user-composition/actions/userQueryActions';
import { useTier } from '@/context/TierContext';
import { useProduct } from '@/context/ProductContext';
import { filterMenuSectionsByProduct } from '@/lib/productSurfaceRegistry';
import { getLicenseStatus } from '@/lib/actions/licenseManagementActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export function filterNavigationSectionsBySelfHost(
  sections: readonly NavigationSection[],
  selfHostMode: boolean,
): NavigationSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.requiresSelfHost || selfHostMode),
    }))
    .filter((section) => section.items.length > 0);
}

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
  const opportunitiesFlag = useFeatureFlag('opportunities-module', { defaultValue: false });
  const opportunitiesEnabled =
    typeof opportunitiesFlag === 'boolean' ? opportunitiesFlag : opportunitiesFlag?.enabled ?? false;
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [selfHostMode, setSelfHostMode] = useState(false);
  const { hasFeature } = useTier();
  const { productCode } = useProduct();
  const isAlgaDesk = productCode === 'algadesk';

  useEffect(() => {
    let isMounted = true;
    getLicenseStatus()
      .then((result) => {
        if (isMounted && !isActionPermissionError(result)) {
          setSelfHostMode(result.selfHostMode);
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

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
      items: section.items
        .filter((item) => item.name !== 'Opportunities' || opportunitiesEnabled)
        .map((item) => {
        if (item.name === 'Workflows') {
          const filteredSubItems = item.subItems?.filter((subItem) => {
            if (subItem.name !== 'Dead Letter') return true;
            return canWorkflowAdmin;
          });
          return { ...item, subItems: filteredSubItems };
        }

        return item;
      })
    }));

    return filterMenuSectionsByProduct(
      productCode,
      filterNavigationSectionsByFeatureAccess(filteredSections, hasFeature),
    );
  }, [canWorkflowAdmin, useNavigationSections, hasFeature, productCode, opportunitiesEnabled]);

  const settingsSections = useMemo<NavigationSection[]>(() => {
    const productSections = filterMenuSectionsByProduct(productCode, settingsNavigationSections);
    const opportunitiesFilteredSections = productSections.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.name !== 'Opportunities' || opportunitiesEnabled),
    }));

    return filterNavigationSectionsBySelfHost(
      opportunitiesFilteredSections,
      selfHostMode,
    );
  }, [opportunitiesEnabled, productCode, selfHostMode]);

  return (
    <Sidebar
      {...props}
      menuSections={menuSections}
      bottomMenuItems={bottomMenuItems}
      appDisplayName={isAlgaDesk ? 'AlgaDesk' : 'AlgaPSA'}
      appLogoAlt={isAlgaDesk ? 'AlgaDesk Logo' : 'AlgaPSA Logo'}
      settingsSectionsOverride={settingsSections}
    />
  );
}
