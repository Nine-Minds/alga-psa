'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { ClientDetailsSettings } from './ClientDetailsSettings';
import { UserManagementSettings } from './UserManagementSettings';
import ClientAccount from '../account/ClientAccount';
import { DrawerProvider } from "@alga-psa/ui";
import { checkClientPortalPermissions } from '../../actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

// Tab identifiers (stable, locale-independent keys)
type TabId = 'account' | 'client-details' | 'user-management';

// Valid URL slugs
const VALID_TAB_SLUGS: TabId[] = ['account', 'client-details', 'user-management'];
const DEFAULT_TAB: TabId = 'account';

export default function ClientPortalSettingsPage() {
  const { t } = useTranslation('clientPortal');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const hydrationReadyRef = useRef(false);

  const [hasUserManagementAccess, setHasUserManagementAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Map URL slugs to translated labels (memoized to avoid recalculation)
  const slugToLabelMap = useMemo<Record<TabId, string>>(() => ({
    'account': t('clientSettings.tabs.account'),
    'client-details': t('clientSettings.tabs.clientDetails'),
    'user-management': t('clientSettings.tabs.userManagement')
  }), [t]);

  // Map translated labels back to URL slugs
  const labelToSlugMap = useMemo<Record<string, TabId>>(() => {
    return Object.entries(slugToLabelMap).reduce((acc, [slug, label]) => {
      acc[label] = slug as TabId;
      return acc;
    }, {} as Record<string, TabId>);
  }, [slugToLabelMap]);

  // Determine initial tab from URL or default
  const initialTabLabel = useMemo(() => {
    if (tabParam && VALID_TAB_SLUGS.includes(tabParam.toLowerCase() as TabId)) {
      return slugToLabelMap[tabParam.toLowerCase() as TabId];
    }
    return slugToLabelMap[DEFAULT_TAB];
  }, [tabParam, slugToLabelMap]);

  const [activeTab, setActiveTab] = useState<string>(initialTabLabel);

  // Update URL when tab changes (after hydration)
  const updateURL = useCallback((tabLabel: string) => {
    if (!hydrationReadyRef.current) return;

    const urlSlug = labelToSlugMap[tabLabel];
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== DEFAULT_TAB) {
      currentSearchParams.set('tab', urlSlug);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `/client-portal/settings?${currentSearchParams.toString()}`
      : '/client-portal/settings';

    window.history.pushState({}, '', newUrl);
  }, [labelToSlugMap]);

  // Handle client-side initialization and URL changes
  useEffect(() => {
    hydrationReadyRef.current = true;

    setActiveTab((prev) => (prev === initialTabLabel ? prev : initialTabLabel));
  }, [initialTabLabel]);

  // Handle tab change with URL synchronization
  const handleTabChange = useCallback((tabLabel: string) => {
    setActiveTab(tabLabel);
    updateURL(tabLabel);
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
          text={t('common.loading')}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  const tabs = [
    {
      label: slugToLabelMap['account'],
      content: <ClientAccount />
    },
    {
      label: slugToLabelMap['client-details'],
      content: <ClientDetailsSettings />
    }
  ];

  // Only add User Management tab if user has permission
  if (hasUserManagementAccess) {
    tabs.push({
      label: slugToLabelMap['user-management'],
      content: <UserManagementSettings />
    });
  }

  return (
    <DrawerProvider>
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t('clientSettings.title')}</h1>
        <p className="text-gray-600">
          {t('clientSettings.description')}
        </p>
      </div>

      <CustomTabs
        tabs={tabs}
        defaultTab={activeTab}
        onTabChange={handleTabChange}
        data-automation-type="client-portal-settings-tabs"
      />
    </div>
    </DrawerProvider>
  );
}
