'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import Sidebar from './Sidebar';
import {
  bottomMenuItems,
  menuItems as legacyMenuItems,
  navigationSections as originalSections,
  type NavigationSection
} from '@/config/menuConfig';
import { getCurrentUserPermissions } from '@alga-psa/users/actions';

type SidebarWithFeatureFlagsProps = React.ComponentProps<typeof Sidebar>;

export default function SidebarWithFeatureFlags(props: SidebarWithFeatureFlagsProps) {
  const navigationFlag = useFeatureFlag('ui-navigation-v2', { defaultValue: true });
  const useNavigationSections =
    typeof navigationFlag === 'boolean' ? navigationFlag : navigationFlag?.enabled ?? false;
  const emailLogsFlag = useFeatureFlag('email-logs', { defaultValue: false });
  const emailLogsEnabled = typeof emailLogsFlag === 'boolean' ? emailLogsFlag : emailLogsFlag?.enabled ?? false;
  const [userPermissions, setUserPermissions] = useState<string[]>([]);

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

    return baseSections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        if (item.name !== 'Automation Hub') {
          if (item.name === 'System Monitor' && item.subItems && !emailLogsEnabled) {
            return {
              ...item,
              subItems: item.subItems.filter((subItem) => subItem.name !== 'Email Logs'),
            };
          }
          return item;
        }

        const filteredSubItems = item.subItems?.filter((subItem) => {
          if (subItem.name !== 'Dead Letter') return true;
          return canWorkflowAdmin;
        });

        return {
          ...item,
          subItems: filteredSubItems
        };
      })
    }));
  }, [canWorkflowAdmin, useNavigationSections, emailLogsEnabled]);

  return (
    <Sidebar
      {...props}
      menuSections={menuSections}
      bottomMenuItems={bottomMenuItems}
    />
  );
}
