import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import EntraIntegrationRouteBody from './EntraIntegrationRouteBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('integrations');
}

export default function EntraIntegrationRoute() {
  return (
    <SettingsTab tabId="integrations">
      <EntraIntegrationRouteBody />
    </SettingsTab>
  );
}
