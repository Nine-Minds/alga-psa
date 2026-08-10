import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import UserManagement from '@/components/settings/general/UserManagement';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('users');
}

export default function UsersSettingsRoute() {
  return (
    <SettingsTab tabId="users">
      <UserManagement />
    </SettingsTab>
  );
}
