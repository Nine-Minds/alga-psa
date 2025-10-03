'use client';

import { useEffect, useState } from 'react';
import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import { ClientDetailsSettings } from './ClientDetailsSettings';
import { UserManagementSettings } from './UserManagementSettings';
import ClientAccount from '../account/ClientAccount';
import { DrawerProvider } from "server/src/context/DrawerContext";
import { checkClientPortalPermissions } from 'server/src/lib/actions/client-portal-actions/clientUserActions';
import { useTranslation } from 'server/src/lib/i18n/client';

export default function ClientPortalSettingsPage() {
  const { t } = useTranslation('clientPortal');
  const [hasUserManagementAccess, setHasUserManagementAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkPermissions = async () => {
      const permissions = await checkClientPortalPermissions();
      setHasUserManagementAccess(permissions.hasUserManagementAccess);
      setIsLoading(false);
    };
    checkPermissions();
  }, []);

  if (isLoading) {
    return <div>{t('common.loading')}</div>;
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
        data-automation-type="client-portal-settings-tabs"
      />
    </div>
    </DrawerProvider>
  );
}
