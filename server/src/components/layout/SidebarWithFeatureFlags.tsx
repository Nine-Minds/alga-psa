'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useCapability, useFeatureFlag, useServedCapabilities } from '@alga-psa/ui/hooks';
import { resolveUiSlots } from '@alga-psa/ui/capability/uiSlotRegistry';
import '@/config/coManagedMenu';
import { useCoManagedPurchaseNavigation } from '@enterprise/components/co-managed/useCoManagedPurchaseNavigation';
import { CO_MANAGED_ACCESS_CHANGED } from '@/components/co-managed/accessRefresh';
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
import { resolveCurrentUserGrants } from '@/lib/auth/currentUserGrants';
import { useTier } from '@/context/TierContext';
import { TIER_FEATURES } from '@alga-psa/types';
import { useProduct } from '@/context/ProductContext';
import { filterMenuSectionsByProduct } from '@/lib/productSurfaceRegistry';
import { getLicenseStatus } from '@/lib/actions/licenseManagementActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

const CO_MANAGED_ROOT_HREF = '/msp/co-managed';
const CO_MANAGED_ADMINISTRATION_HREF = '/msp/co-management/administration';
/** Menu rows that exist only while the co-managed capability is served. */
export const CO_MANAGED_GATED_HREFS: ReadonlySet<string> = new Set([CO_MANAGED_ADMINISTRATION_HREF, '/msp/tickets/customer']);

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

export function filterMenuItemsByPermission(
  items: readonly MenuItem[],
  permissions: readonly string[],
): MenuItem[] {
  return items.reduce<MenuItem[]>((visibleItems, item) => {
    const required = item.requiredPermission === undefined ? [] : [item.requiredPermission].flat();
    if (!required.every((key) => permissions.includes(key))) {
      return visibleItems;
    }

    const filteredSubItems = item.subItems
      ? filterMenuItemsByPermission(item.subItems, permissions)
      : undefined;

    // A group whose children were all hidden has nothing left to open.
    if (item.subItems && filteredSubItems?.length === 0 && !item.href) {
      return visibleItems;
    }

    visibleItems.push(filteredSubItems ? { ...item, subItems: filteredSubItems } : item);
    return visibleItems;
  }, []);
}

/** Every `requiredPermission` key in the menu tree (plus `extra`), de-duplicated and sorted. */
export function collectRequiredPermissionKeys(
  sections: readonly NavigationSection[],
  extra: readonly string[] = [],
): string[] {
  const keys = new Set<string>(extra);
  const visit = (items: readonly MenuItem[]) => items.forEach((item) => {
    if (item.requiredPermission !== undefined) [item.requiredPermission].flat().forEach((key) => keys.add(key));
    if (item.subItems) visit(item.subItems);
  });
  sections.forEach((section) => visit(section.items));
  return [...keys].sort();
}

export function filterNavigationSectionsByPermission(
  sections: readonly NavigationSection[],
  permissions: readonly string[],
): NavigationSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: filterMenuItemsByPermission(section.items, permissions),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Merges the commercial first-purchase contribution into the sections. Commercial eligibility is its own
 * fact: it shows the overview root without `co_management:read`, and only the root (the archive row keeps its
 * own gate). When the served group already carries the root the two paths collapse to one link; otherwise the
 * contribution supplies it. Exactly one Co-managed IT link survives either way.
 */
export function mergeCoManagedPurchaseSection(
  sections: readonly NavigationSection[],
  purchase: NavigationSection | null,
): NavigationSection[] {
  if (!purchase) return [...sections];
  const hasRoot = sections.some((section) => section.items.some((item) => item.href === CO_MANAGED_ROOT_HREF));
  if (!hasRoot) return [...sections, purchase];
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => item.href === CO_MANAGED_ROOT_HREF && item.requiredPermission
      ? { ...item, requiredPermission: undefined }
      : item),
  }));
}

type SidebarWithFeatureFlagsProps = React.ComponentProps<typeof Sidebar>;

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
  const { t } = useTranslation('msp/core');
  const navigationFlag = useFeatureFlag('ui-navigation-v2', { defaultValue: true });
  const useNavigationSections =
    typeof navigationFlag === 'boolean' ? navigationFlag : navigationFlag?.enabled ?? false;
  // Server-bootstrapped capability verdict (serves); never the raw rollout flag.
  const { enabled: coManagedServed } = useCapability('co-managed');
  const servedCapabilities = useServedCapabilities();
  // Server-authoritative commercial eligibility (EE only; the community stub is always null).
  const purchaseNavigation = useCoManagedPurchaseNavigation();
  const marketingFlag = useFeatureFlag('marketing-module', { defaultValue: false });
  const marketingEnabled =
    typeof marketingFlag === 'boolean' ? marketingFlag : marketingFlag?.enabled ?? false;
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [selfHostMode, setSelfHostMode] = useState(false);
  const { hasFeature } = useTier();
  // Mirrors the menuConfig tier gate so the vault nav item tracks the tenant tier.
  const credentialsVaultEnabled = hasFeature(TIER_FEATURES.CREDENTIALS);
  const { productCode, surfaceKind, edition } = useProduct();
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

  // Capability-gated contributions join before the edition → tier →
  // permission → product chain, which then filters them like any menu item.
  const contributedSections = useMemo<NavigationSection[]>(
    () => resolveUiSlots<NavigationSection>('msp.navigation.group', servedCapabilities).flatMap((slot) => (slot.props ? [slot.props] : [])),
    [servedCapabilities],
  );

  // Resolve exactly the permissions the menu gates on, through the server's hasPermission engine.
  const requiredPermissionKeys = useMemo(
    () => collectRequiredPermissionKeys([
      ...originalSections,
      { title: '', items: legacyMenuItems },
      ...billingNavigationSections,
      ...contributedSections,
      ...(purchaseNavigation ? [purchaseNavigation] : []),
    ], ['workflow:admin']).join('|'),
    [contributedSections, purchaseNavigation],
  );

  useEffect(() => {
    let isMounted = true;
    const loadPermissions = () => {
      resolveCurrentUserGrants(requiredPermissionKeys.split('|'))
        .then((granted) => {
          if (isMounted) setUserPermissions(granted);
        })
        .catch((error) => {
          console.error('[Sidebar] Failed to load user permissions:', error);
          if (isMounted) setUserPermissions([]);
        });
    };

    loadPermissions();
    // A verified purchase can change the permissions the server derives; re-read them, never infer them.
    window.addEventListener(CO_MANAGED_ACCESS_CHANGED, loadPermissions);
    return () => {
      isMounted = false;
      window.removeEventListener(CO_MANAGED_ACCESS_CHANGED, loadPermissions);
    };
  }, [requiredPermissionKeys]);

  const canWorkflowAdmin = userPermissions.includes('workflow:admin');

  // Filter and modify menu items based on permissions
  const menuSections = useMemo<NavigationSection[]>(() => {
    // The contribution joins the same chain; the served group's root is relieved of its permission only
    // when the server's commercial decision is open, and the archive row never is.
    const baseSections = mergeCoManagedPurchaseSection(useNavigationSections
      ? [...originalSections, ...contributedSections]
      : [{ title: '', items: legacyMenuItems } satisfies NavigationSection, ...contributedSections], purchaseNavigation);

    const filteredSections = baseSections.map((section) => ({
      ...section,
      items: section.items
        .filter((item) => coManagedServed || !item.href || !CO_MANAGED_GATED_HREFS.has(item.href))
        .map((item) => (!coManagedServed && item.subItems?.some((sub) => sub.href && CO_MANAGED_GATED_HREFS.has(sub.href))
          ? { ...item, subItems: item.subItems.filter((sub) => !sub.href || !CO_MANAGED_GATED_HREFS.has(sub.href)) }
          : item))
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
      { productCode, surfaceKind },
      filterNavigationSectionsByPermission(
        filterNavigationSectionsByFeatureAccess(editionSections, hasFeature),
        userPermissions,
      ),
    );
  }, [canWorkflowAdmin, userPermissions, useNavigationSections, hasFeature, productCode, surfaceKind, edition, marketingEnabled, credentialsVaultEnabled, coManagedServed, contributedSections, purchaseNavigation]);

  const settingsSections = useMemo<NavigationSection[]>(() => {
    const editionSections = filterNavigationSectionsByEdition(settingsNavigationSections, edition);
    const productSections = filterMenuSectionsByProduct({ productCode, surfaceKind }, editionSections);

    return filterNavigationSectionsBySelfHost(
      productSections,
      selfHostMode,
    );
  }, [edition, productCode, surfaceKind, selfHostMode]);

  // The footer links answer to the same principal as the sections above: a seat technician's surface
  // reaches neither settings nor the external support link.
  const footerItems = useMemo(
    () => filterMenuSectionsByProduct({ productCode, surfaceKind }, [{ items: bottomMenuItems }]).flatMap((section) => section.items),
    [productCode, surfaceKind],
  );

  const billingSections = useMemo(
    () => filterNavigationSectionsByPermission(
      filterNavigationSectionsByEdition(billingNavigationSections, edition),
      userPermissions,
    ),
    [edition, userPermissions],
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
      bottomMenuItems={footerItems}
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
