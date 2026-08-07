import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import ClientPortalSettings from '@/components/settings/general/ClientPortalSettings';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('client-portal');
}

export default function ClientPortalSettingsRoute() {
  return (
    <SettingsTab tabId="client-portal">
      <ClientPortalSettings />
    </SettingsTab>
  );
}
