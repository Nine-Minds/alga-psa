'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { ClientDetailsSettings } from './ClientDetailsSettings';
import { UserManagementSettings } from './UserManagementSettings';
import ClientAccount from '../account/ClientAccount';
import { DrawerProvider, DrawerOutlet } from "@alga-psa/ui";
import { checkClientPortalPermissions } from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

// Tab identifiers (stable, locale-independent keys)
type TabId = 'account' | 'client-details' | 'user-management';

// Valid URL slugs
const VALID_TAB_SLUGS: TabId[] = ['account', 'client-details', 'user-management'];
const DEFAULT_TAB: TabId = 'account';

export default function ClientPortalSettingsPage() {
  const { t: tProfile } = useTranslation('client-portal');
  const { t: tCommon } = useTranslation('common');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const hydrationReadyRef = useRef(false);

  const [hasUserManagementAccess, setHasUserManagementAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Determine initial tab from URL or default
  const initialTabId = useMemo(() => {
    if (tabParam && VALID_TAB_SLUGS.includes(tabParam.toLowerCase() as TabId)) {
      return tabParam.toLowerCase() as TabId;
    }
    return DEFAULT_TAB;
  }, [tabParam]);

  const [activeTab, setActiveTab] = useState<TabId>(initialTabId);

  // Update URL when tab changes (after hydration)
  const updateURL = useCallback((tabId: TabId) => {
    if (!hydrationReadyRef.current) return;

    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_TAB) {
      currentSearchParams.set('tab', tabId);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `/client-portal/client-settings?${currentSearchParams.toString()}`
      : '/client-portal/client-settings';

    window.history.pushState({}, '', newUrl);
  }, []);

  // Handle client-side initialization and URL changes
  useEffect(() => {
    hydrationReadyRef.current = true;

    setActiveTab((prev) => (prev === initialTabId ? prev : initialTabId));
  }, [initialTabId]);

  // Handle tab change with URL synchronization
  const handleTabChange = useCallback((tabId: string) => {
    const nextTab = tabId as TabId;
    setActiveTab(nextTab);
    updateURL(nextTab);
  }, [updateURL]);

  useEffect(() => {
    const checkPermissions = async () => {
      const permissions = await checkClientPortalPermissions();
      setHasUserManagementAccess(permissions.hasUserManagementAccess);
      setIsLoading(false);
    };
    checkPermissions();
  }, []);

  if (isLoading) {
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

  const tabs = [
    {
      id: 'account',
      label: tProfile('clientSettings.tabs.account'),
      content: <ClientAccount />
    },
    {
      id: 'client-details',
      label: tProfile('clientSettings.tabs.clientDetails'),
      content: <ClientDetailsSettings />
    }
  ];

  // Only add User Management tab if user has permission
  if (hasUserManagementAccess) {
    tabs.push({
      id: 'user-management',
      label: tProfile('clientSettings.tabs.userManagement'),
      content: <UserManagementSettings />
    });
  }

  return (
    <DrawerProvider>
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{tProfile('clientSettings.title')}</h1>
        <p className="text-gray-600">
          {tProfile('clientSettings.description')}
        </p>
      </div>

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
