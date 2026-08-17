'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import Sidebar from './Sidebar';
import {
  bottomMenuItems,
  billingNavigationSections,
  extensionsNavigationSections,
  inventoryNavigationSections,
  menuItems as legacyMenuItems,
  navigationSections as originalSections,
  settingsNavigationSections,
  type MenuItem,
  type MenuEdition,
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

export function filterMenuItemsByEdition(
  items: readonly MenuItem[],
  edition: MenuEdition,
): MenuItem[] {
  return items.reduce<MenuItem[]>((visibleItems, item) => {
    if (item.availableEditions && !item.availableEditions.includes(edition)) {
      return visibleItems;
    }

    const filteredSubItems = item.subItems
      ? filterMenuItemsByEdition(item.subItems, edition)
      : undefined;

    if (item.subItems && filteredSubItems?.length === 0 && !item.href) {
      return visibleItems;
    }

    visibleItems.push({
      ...item,
      subItems: filteredSubItems,
    });

    return visibleItems;
  }, []);
}

export function filterNavigationSectionsByEdition(
  sections: readonly NavigationSection[],
  edition: MenuEdition,
): NavigationSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: filterMenuItemsByEdition(section.items, edition),
    }))
    .filter((section) => section.items.length > 0);
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
  const { t } = useTranslation('msp/core');
  const navigationFlag = useFeatureFlag('ui-navigation-v2', { defaultValue: true });
  const useNavigationSections =
    typeof navigationFlag === 'boolean' ? navigationFlag : navigationFlag?.enabled ?? false;
  const marketingFlag = useFeatureFlag('marketing-module', { defaultValue: false });
  const marketingEnabled =
    typeof marketingFlag === 'boolean' ? marketingFlag : marketingFlag?.enabled ?? false;
  const credentialsVaultFlag = useFeatureFlag('release-v1.5-feature', { defaultValue: false });
  const credentialsVaultEnabled =
    typeof credentialsVaultFlag === 'boolean'
      ? credentialsVaultFlag
      : credentialsVaultFlag?.enabled ?? false;
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [selfHostMode, setSelfHostMode] = useState(false);
  const { hasFeature } = useTier();
  const { productCode, edition } = useProduct();
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
        .filter((item) => item.name !== 'Marketing' || marketingEnabled)
        .filter((item) => item.name !== 'Passwords' || credentialsVaultEnabled)
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

    const editionSections = filterNavigationSectionsByEdition(filteredSections, edition);

    return filterMenuSectionsByProduct(
      productCode,
      filterNavigationSectionsByFeatureAccess(editionSections, hasFeature),
    );
  }, [canWorkflowAdmin, useNavigationSections, hasFeature, productCode, edition, marketingEnabled, credentialsVaultEnabled]);

  const settingsSections = useMemo<NavigationSection[]>(() => {
    const editionSections = filterNavigationSectionsByEdition(settingsNavigationSections, edition);
    const productSections = filterMenuSectionsByProduct(productCode, editionSections);

    return filterNavigationSectionsBySelfHost(
      productSections,
      selfHostMode,
    );
  }, [edition, productCode, selfHostMode]);

  const billingSections = useMemo(
    () => filterNavigationSectionsByEdition(billingNavigationSections, edition),
    [edition],
  );
  const extensionsSections = useMemo(
    () => filterNavigationSectionsByEdition(extensionsNavigationSections, edition),
    [edition],
  );
  const inventorySections = useMemo(
    () => filterNavigationSectionsByEdition(inventoryNavigationSections, edition),
    [edition],
  );

  return (
    <Sidebar
      {...props}
      menuSections={menuSections}
      bottomMenuItems={bottomMenuItems}
      appDisplayName={isAlgaDesk ? 'AlgaDesk' : 'AlgaPSA'}
      appLogoAlt={t('sidebar.appLogoAlt', {
        appName: isAlgaDesk ? 'AlgaDesk' : 'AlgaPSA',
        defaultValue: '{{appName}} Logo',
      })}
      settingsSectionsOverride={settingsSections}
      billingSectionsOverride={billingSections}
      extensionsSectionsOverride={extensionsSections}
      inventorySectionsOverride={inventorySections}
    />
  );
}
