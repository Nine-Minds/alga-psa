import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import UserManagement from '@/components/settings/general/UserManagement';

export const metadata: Metadata = { title: getSettingsTabTitle('users') };

export default function UsersSettingsRoute() {
  return (
    <SettingsTab tabId="users">
      <UserManagement />
    </SettingsTab>
  );
}
