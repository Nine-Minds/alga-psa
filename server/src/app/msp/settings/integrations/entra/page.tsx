import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import EntraIntegrationRouteBody from './EntraIntegrationRouteBody';

export const metadata: Metadata = { title: getSettingsTabTitle('integrations') };

export default function EntraIntegrationRoute() {
  return (
    <SettingsTab tabId="integrations">
      <EntraIntegrationRouteBody />
    </SettingsTab>
  );
}
