import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import MspLanguageSettings from '@/components/settings/general/MspLanguageSettings';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('language');
}

export default function LanguageSettingsRoute() {
  return (
    <SettingsTab tabId="language">
      <MspLanguageSettings />
    </SettingsTab>
  );
}
