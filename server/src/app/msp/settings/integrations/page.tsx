import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import IntegrationsSettingsBody from './IntegrationsSettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('integrations');
}

export default function IntegrationsSettingsRoute() {
  return (
    <SettingsTab tabId="integrations">
      <IntegrationsSettingsBody />
    </SettingsTab>
  );
}
