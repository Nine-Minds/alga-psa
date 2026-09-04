import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import { SecretsManagement } from '@/components/settings/secrets';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('secrets');
}

export default function SecretsSettingsRoute() {
  return (
    <SettingsTab tabId="secrets">
      <SecretsManagement />
    </SettingsTab>
  );
}
