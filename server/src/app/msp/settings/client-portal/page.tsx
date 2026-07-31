import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import ClientPortalSettings from '@/components/settings/general/ClientPortalSettings';

export const metadata: Metadata = { title: getSettingsTabTitle('client-portal') };

export default function ClientPortalSettingsRoute() {
  return (
    <SettingsTab tabId="client-portal">
      <ClientPortalSettings />
    </SettingsTab>
  );
}
