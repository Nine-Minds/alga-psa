'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { ClientDetailsSettings } from './ClientDetailsSettings';
import { UserManagementSettings } from './UserManagementSettings';
import ClientAccount from '../account/ClientAccount';
import { VisibilityGroupsSettings } from './VisibilityGroupsSettings';
import { DrawerProvider, DrawerOutlet } from "@alga-psa/ui";
import { checkClientPortalPermissions } from '../../actions/client-portal-actions/clientUserActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  coerceClientPortalSettingsTab,
  resolveClientPortalSettingsSurfaces,
  type ClientPortalSettingsSurfaces,
  type ClientPortalSettingsTab,
} from '../../lib/clientPortalSettingsSurfaces';

export default function ClientPortalSettingsPage() {
  const { t: tProfile } = useTranslation('client-portal');
  const { t: tCommon } = useTranslation('common');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const hydrationReadyRef = useRef(false);

  // null until permissions have loaded, so no tab the user may not see is ever flashed.
  const [surfaces, setSurfaces] = useState<ClientPortalSettingsSurfaces | null>(null);
  const [selectedTab, setSelectedTab] = useState<ClientPortalSettingsTab | null>(null);

  const defaultTab = surfaces?.tabs[0];
  // ?tab= is honoured only if permitted; otherwise coerced to the first permitted tab.
  const urlTab = useMemo(
    () => (surfaces ? coerceClientPortalSettingsTab(tabParam, surfaces) : undefined),
    [surfaces, tabParam],
  );
  const activeTab = selectedTab ?? urlTab;

  // Update URL when tab changes (after hydration)
  const updateURL = useCallback((tabId: ClientPortalSettingsTab) => {
    if (!hydrationReadyRef.current) return;

    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== defaultTab) {
      currentSearchParams.set('tab', tabId);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `/client-portal/client-settings?${currentSearchParams.toString()}`
      : '/client-portal/client-settings';

    window.history.pushState({}, '', newUrl);
  }, [defaultTab]);

  useEffect(() => {
    hydrationReadyRef.current = true;
  }, []);

  // A changed URL (e.g. back button) takes over from the last clicked tab.
  useEffect(() => {
    setSelectedTab(null);
  }, [tabParam]);

  const handleTabChange = useCallback((tabId: string) => {
    const nextTab = tabId as ClientPortalSettingsTab;
    setSelectedTab(nextTab);
    updateURL(nextTab);
  }, [updateURL]);

  useEffect(() => {
    let mounted = true;
    const checkPermissions = async () => {
      const permissions = await checkClientPortalPermissions();
      if (!mounted) return;
      setSurfaces(resolveClientPortalSettingsSurfaces(permissions));
    };
    checkPermissions();
    return () => { mounted = false; };
  }, []);

  if (!surfaces) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text={tCommon('common.loading')}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  // The server route guard 404s this case; nothing to render client-side either.
  if (!activeTab) return null;

  const tabContent: Record<ClientPortalSettingsTab, { label: string; content: React.ReactNode }> = {
    'account': {
      label: tProfile('clientSettings.tabs.account'),
      content: (
        <ClientAccount
          showPlanCard={surfaces.showPlanCard}
          showInvoicesCard={surfaces.showInvoicesCard}
        />
      ),
    },
    'client-details': {
      label: tProfile('clientSettings.tabs.clientDetails'),
      content: <ClientDetailsSettings />,
    },
    'user-management': {
      label: tProfile('clientSettings.tabs.userManagement'),
      content: <UserManagementSettings />,
    },
    'visibility-groups': {
      label: tProfile('clientSettings.tabs.visibilityGroups'),
      content: <VisibilityGroupsSettings />,
    },
  };

  const tabs = surfaces.tabs.map((id) => ({ id, ...tabContent[id] }));

  return (
    <DrawerProvider>
    <div className="container mx-auto py-6">
      <CustomTabs
        tabs={tabs}
        defaultTab={activeTab}
        onTabChange={handleTabChange}
        data-automation-type="client-portal-settings-tabs"
      />
    </div>
    <DrawerOutlet />
    </DrawerProvider>
  );
}
