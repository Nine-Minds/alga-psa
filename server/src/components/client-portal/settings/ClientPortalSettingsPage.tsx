'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import { ClientDetailsSettings } from './ClientDetailsSettings';
import { UserManagementSettings } from './UserManagementSettings';
import ClientAccount from '../account/ClientAccount';
import { DrawerProvider } from "server/src/context/DrawerContext";
import { checkClientPortalPermissions } from 'server/src/lib/actions/client-portal-actions/clientUserActions';
import { useTranslation } from 'server/src/lib/i18n/client';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

// Map URL slugs to tab labels
const TAB_SLUG_TO_LABEL: Record<string, string> = {
  'account': 'Account',
  'client-details': 'Client Details',
  'user-management': 'User Management'
};

// Map tab labels to URL slugs
const TAB_LABEL_TO_SLUG: Record<string, string> = {
  'Account': 'account',
  'Client Details': 'client-details',
  'User Management': 'user-management'
};

export default function ClientPortalSettingsPage() {
  const { t } = useTranslation('clientPortal');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  const [hasUserManagementAccess, setHasUserManagementAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Determine initial tab from URL or default to "Account"
  const initialTab = useMemo(() => {
    const labelFromUrl = tabParam ? TAB_SLUG_TO_LABEL[tabParam.toLowerCase()] : undefined;
    return labelFromUrl || 'Account';
  }, [tabParam]);

  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // Update active tab when URL parameter changes
  useEffect(() => {
    const labelFromUrl = tabParam ? TAB_SLUG_TO_LABEL[tabParam.toLowerCase()] : undefined;
    const targetTab = labelFromUrl || 'Account';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, activeTab]);

  // Handle tab change and update URL
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const slug = TAB_LABEL_TO_SLUG[tab];
      if (slug === 'account') {
        params.delete('tab');
      } else if (slug) {
        params.set('tab', slug);
      }
      const newUrl = params.toString()
        ? `/client-portal/settings?${params.toString()}`
        : '/client-portal/settings';
      window.history.pushState({}, '', newUrl);
    }
  };

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
      label: t('clientSettings.tabs.account'),
      content: <ClientAccount />
    },
    {
      label: t('clientSettings.tabs.clientDetails'),
      content: <ClientDetailsSettings />
    }
  ];

  // Only add User Management tab if user has permission
  if (hasUserManagementAccess) {
    tabs.push({
      label: t('clientSettings.tabs.userManagement'),
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
