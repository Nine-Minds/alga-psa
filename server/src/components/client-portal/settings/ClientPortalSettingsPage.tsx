'use client';

import { useEffect, useState } from 'react';
import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import EmailRegistrationContainer from './EmailRegistrationContainer';
import { CompanyDetailsSettings } from './CompanyDetailsSettings';
import { UserManagementSettings } from './UserManagementSettings';
import ClientAccount from '../account/ClientAccount';
import { DrawerProvider } from "server/src/context/DrawerContext";
import { checkClientPortalPermissions } from 'server/src/lib/actions/client-portal-actions/clientUserActions';

export default function ClientPortalSettingsPage() {
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
    return <div>Loading...</div>;
  }

  const tabs = [
    {
      label: 'Account',
      content: <ClientAccount />
    },
    {
      label: 'Company Details',
      content: <CompanyDetailsSettings />
    },
    {
      label: 'Email Registration',
      content: <EmailRegistrationContainer />
    }
  ];
  
  // Only add User Management tab if user has permission
  if (hasUserManagementAccess) {
    tabs.push({
      label: 'User Management',
      content: <UserManagementSettings />
    });
  }

  return (
    <DrawerProvider>
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Company Settings</h1>
        <p className="text-gray-600">
          Manage your company settings and configurations.
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
