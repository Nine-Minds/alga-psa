import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import EmailRegistrationContainer from './EmailRegistrationContainer';
import { CompanyDetailsSettings } from './CompanyDetailsSettings';
import { UserManagementSettings } from './UserManagementSettings';
import { DrawerProvider } from "server/src/context/DrawerContext";

export default function ClientPortalSettingsPage() {
  const tabs = [
    {
      label: 'Company Details',
      content: <CompanyDetailsSettings />
    },
    {
      label: 'Email Registration',
      content: <EmailRegistrationContainer />
    },
    {
      label: 'User Management',
      content: <UserManagementSettings />
    }
  ];

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
