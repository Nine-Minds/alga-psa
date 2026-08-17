import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import AppearanceSettings from '@/components/settings/general/AppearanceSettings';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('appearance');
}

export default function AppearanceSettingsRoute() {
  return (
    <SettingsTab tabId="appearance">
      <AppearanceSettings />
    </SettingsTab>
  );
}
